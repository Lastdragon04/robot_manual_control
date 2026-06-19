#!/usr/bin/env python3
"""
MCP Server - 机器人控制 MCP 服务（SSE 传输）
每个数据库中的动作组自动映射为一个 MCP Tool，Claude 直接选择调用。

启动方式:
  ros2 run mcp_control mcp_server --ros-args -p robot_name:=天轶2.0Pro -p port:=9876
"""

import json
import threading
import logging
import requests

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from mcp.server.fastmcp import FastMCP

# ─── Tool 调用日志 ───
_tool_logger = logging.getLogger('mcp_tool_calls')
_tool_logger.setLevel(logging.INFO)
_log_file = "/home/zck/workspace/robot_manual_control/manual_control/log/mcp_tool_calls.log"
_fh = logging.FileHandler(_log_file)
_fh.setFormatter(logging.Formatter('%(asctime)s | %(message)s', datefmt='%Y-%m-%d %H:%M:%S'))
_tool_logger.addHandler(_fh)
_tool_logger.propagate = False

# ─── 共享状态（由 main() 初始化） ───
_mcp = None  # FastMCP 实例
_http_base = "http://localhost:3754"
_tools_store = {}  # {name: {"id": ..., "description": ...}}
_current_tool_names = set()


def _http_api(method, path, data=None):
    """HTTP API 请求"""
    try:
        r = requests.request(method, f"{_http_base}{path}", json=data, timeout=30)
        return r.json()
    except requests.RequestException as e:
        return {"error": str(e)}


def _make_tool_fn(tool_name):
    """为指定动作组创建工具函数"""

    def run_action(cycle: bool = False, start_from: float = 0.0) -> str:
        gid = _tools_store[tool_name]["id"]
        _tool_logger.info(
            "tool=%s | cycle=%s | start_from=%s", tool_name, cycle, start_from)
        result = _http_api("POST", "/action_group/run", {
            "group_id": gid,
            "cycle": cycle,
            "start_from": start_from
        })
        if "error" in result:
            return f"❌ 执行失败 [{tool_name}]: {result['error']}"
        return f"✅ 已执行 [{tool_name}]{' (循环)' if cycle else ''}"

    # 用工具名作为函数名（中文也可用作 Python 函数名）
    run_action.__name__ = tool_name
    run_action.__doc__ = _tools_store[tool_name].get("description", f"执行动作组 [{tool_name}]")
    return run_action


def _make_tool_slug(gid, gname):
    """生成 ASCII-safe 的 MCP tool name: action_<id>"""
    return f"action_{gid}"


def _register_tools():
    """从 HTTP API 加载动作组，注册为 FastMCP 工具"""
    global _current_tool_names

    if _mcp is None:
        return

    # 先清除旧工具
    for name in list(_current_tool_names):
        try:
            _mcp._tool_manager.remove_tool(name)
        except Exception:
            pass
    _current_tool_names.clear()

    # 从 HTTP API 获取动作组
    result = _http_api("GET", f"/action_group/get_all")
    if "error" in result:
        print(f"[MCP] 加载动作组失败: {result['error']}", flush=True)
        return

    _tools_store.clear()
    for g in result.get("groups", []):  # (id, name, description, callback, robot_id)
        gid, gname, gdesc = g[0], g[1], g[2]
        _tools_store[gname] = {"id": gid, "description": gdesc or ""}

    for gname, info in _tools_store.items():
        slug = _make_tool_slug(info["id"], gname)
        desc = info["description"] or f"执行动作组 [{gname}]"
        fn = _make_tool_fn(gname)
        _mcp._tool_manager.add_tool(fn, name=slug, description=desc)
        _current_tool_names.add(slug)

    print(f"[MCP] 已注册 {len(_tools_store)} 个工具", flush=True)


class McpServerNode(Node):
    """ROS2 节点：订阅动作组变更通知，自动重载工具"""

    def __init__(self):
        super().__init__('mcp_server_node')
        self.declare_parameter('http_base', 'http://localhost:3754')
        self.declare_parameter('robot_name', '天轶2.0Pro')

        global _http_base
        _http_base = self.get_parameter('http_base').get_parameter_value().string_value

        self.get_logger().info(f"后端: {_http_base}")

        # 初始注册工具
        _register_tools()

        # 订阅 http_control 发来的变更通知，自动重载工具列表
        self.tools_sync_sub = self.create_subscription(
            String, 'mcp_tools_reload', self._on_action_groups_changed, 10)

    def _on_action_groups_changed(self, msg: String):
        """收到 http_control 的动作组变更通知，自动重载工具列表"""
        try:
            data = json.loads(msg.data)
            self.get_logger().info(f"收到变更通知: {data.get('type', 'unknown')}，重载工具...")
        except Exception:
            pass
        _register_tools()
        self.get_logger().info(f"工具列表已重载，现有 {len(_tools_store)} 个工具")


def main():
    global _mcp

    rclpy.init()
    node = McpServerNode()

    host = node.declare_parameter('host', '127.0.0.1').get_parameter_value().string_value
    port = node.declare_parameter('port', 9876).get_parameter_value().integer_value

    # 创建 FastMCP 实例并重新注册工具（因为首次注册时 _mcp 还是 None）
    _mcp = FastMCP("robot-control", host=host, port=port)
    _register_tools()

    # ROS2 spin 在独立线程中运行
    spin_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
    spin_thread.start()

    tool_names = list(_tools_store.keys())
    print(f"[MCP] MCP Server 启动 (SSE 模式)")
    print(f"[MCP] 监听地址: http://{host}:{port}/sse")
    print(f"[MCP] 可用工具 ({len(tool_names)} 个):")
    for gname, info in _tools_store.items():
        slug = _make_tool_slug(info["id"], gname)
        print(f"[MCP]   {slug} → {gname}  |  {info['description']}")
    print(flush=True)

    _mcp.run(transport="sse")


if __name__ == "__main__":
    main()
