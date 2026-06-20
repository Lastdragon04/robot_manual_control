#!/usr/bin/env python3
"""
think_node — 收到语音识别文本，调 LLM 生成回复（支持 Tool Use 控制机器人）

数据流:
  /voice/text (String) → LLM → /voice/reply (String)
                            │
                            └→ tool_use → POST http_control → 机器人动

启动方式:
  ros2 run brain_system think_node --ros-args -p http_base:=http://localhost:3754
"""

import json
import os
import threading

import requests
from anthropic import Anthropic
import time
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

# ── 环境变量兜底 ──
_ENV_API_KEY = os.environ.get("ANTHROPIC_AUTH_TOKEN","sk-1193660b53df45b197cd070e220258aa")
_ENV_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
_ENV_MODEL = os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-pro")

_DEFAULT_SYSTEM_PROMPT = (
    "你是一个有身体的机器人，名字叫天轶。你不只能说话，还能用身体动作来表达自己。\n"
    "拿不准有什么动作可用时，先调 list_actions 看看,如果有不会的动作还是真实点就说这个动作我不会。\n"
    "说话要简短口语化，每句 50 字以内。\n"
    "你是通过语音识别听到用户说话的，偶尔会有同音字、谐音词识别错误，只要大致意思能懂就别纠正这些细节，自然回应就好。"
)

# ── 工具定义 ──

_TOOLS = [
    {
        "name": "list_actions",
        "description": "列出所有可用的机器人动作",
        "input_schema": {"type": "object", "properties": {}},
    },
]


class ThinkNode(Node):
    """LLM 对话节点 + Tool Use 机器人控制"""

    def __init__(self):
        super().__init__("think_node")

        # ── LLM 参数 ──
        self.declare_parameter("api_key", _ENV_API_KEY)
        self.declare_parameter("base_url", _ENV_BASE_URL)
        self.declare_parameter("model", _ENV_MODEL)
        self.declare_parameter("system_prompt", _DEFAULT_SYSTEM_PROMPT)
        self.declare_parameter("max_tokens", 1024)
        self.declare_parameter("temperature", 1.0)
        self.declare_parameter("http_base", "http://localhost:3754")

        api_key = self.get_parameter("api_key").value
        base_url = self.get_parameter("base_url").value
        self.model = self.get_parameter("model").value
        self.system_prompt = self.get_parameter("system_prompt").value
        self.max_tokens = self.get_parameter("max_tokens").value
        self.temperature = self.get_parameter("temperature").value
        self.http_base = self.get_parameter("http_base").value.rstrip("/")

        self.client = Anthropic(api_key=api_key, base_url=base_url)

        # ── 发布 & 订阅 ──
        self.reply_pub = self.create_publisher(String, "/voice/reply", 10)
        self.tool_pub = self.create_publisher(String, "/voice/tool", 10)
        self.text_sub = self.create_subscription(
            String, "/voice/text", self._on_text, 10
        )

        # ── 对话历史 ──
        self._history = []
        self._lock = threading.Lock()

        # ── 加载动作组 Tool ──
        self._first_load = True
        self._action_tools = {}  # {action_<id>: {"name": ..., "id": ..., "description": ...}}
        self._load_action_tools()

        # ── 订阅 http_control 变更通知，动态重载 Tools ──
        self.tools_sync_sub = self.create_subscription(
            String, "mcp_tools_reload", self._on_tools_changed, 10
        )

        self.get_logger().info(
            f"think_node 就绪, model={self.model}, "
            f"tools={len(self._action_tools) + 1} 个"
        )

    # ── Tool 管理 ──

    def _load_action_tools(self):
        """从 http_control 拉取动作组，转成 Anthropic Tool 格式"""
        if self._first_load:
            time.sleep(3)
            self._first_load = False
        try:
            resp = requests.get(
                f"{self.http_base}/action_group/get_all", timeout=10
            )
            groups = resp.json().get("groups", [])
        except requests.RequestException:
            self.get_logger().warn("无法连接 http_control，工具列表为空")
            return

        self._action_tools.clear()
        for g in groups:
            gid, gname, gdesc = g[0], g[1], g[2]
            key = f"action_{gid}"
            self._action_tools[key] = {"id": gid, "name": gname, "description": gdesc or ""}

    def _build_tools(self):
        """构建完整的 tools 列表"""
        action_tools = []
        for key, info in self._action_tools.items():
            gname = info["name"]
            action_tools.append({
                "name": key,
                "description": f"[{gname}] {info['description']}".strip(),
                "input_schema": {
                    "type": "object",
                    "properties": {},
                },
            })
        return _TOOLS + action_tools

    def _on_tools_changed(self, msg: String):
        self.get_logger().info("动作组变更，重载工具列表...")
        self._load_action_tools()
        self.get_logger().info(f"工具已更新，现有 {len(self._action_tools) + 1} 个")

    def _execute_tool(self, tool_name: str, tool_input: dict) -> str:
        """执行工具调用（动作组 fire-and-forget，不阻塞 LLM）"""
        # ── list_actions 内置 ──
        if tool_name == "list_actions":
            if not self._action_tools:
                return "暂无可用动作"
            items = [f"{k}({v['name']})" for k, v in self._action_tools.items()]
            return "可用动作：" + "、".join(items)

        # ── 动作组 → 后台线程执行，立即返回 ──
        info = self._action_tools.get(tool_name)
        if not info:
            return f"未知动作: {tool_name}"

        # 发布 tool 事件，通知前端
        gname = info["name"]
        tool_msg = String()
        tool_msg.data = json.dumps({"name": gname, "action": tool_name})
        self.tool_pub.publish(tool_msg)

        def _fire():
            try:
                requests.post(
                    f"{self.http_base}/action_group/run",
                    json={
                        "group_id": info["id"],
                        "cycle": tool_input.get("cycle", False),
                        "start_from": tool_input.get("start_from", 0.0),
                    },
                    timeout=30,
                )
            except requests.RequestException as e:
                self.get_logger().error(f"动作执行失败 [{tool_name}]: {e}")

        threading.Thread(target=_fire, daemon=True).start()
        return f"正在执行 [{tool_name}]"

    # ── 语音回调 ──

    def _on_text(self, msg: String):
        text = msg.data.strip()
        if not text:
            return
        self.get_logger().info(f"收到: {text}")
        threading.Thread(target=self._call_llm, args=(text,), daemon=True).start()

    # ── LLM 流式调用 + Tool Use ──

    def _call_llm(self, user_text: str):
        with self._lock:
            self._history.append({"role": "user", "content": user_text})
            raw_history = list(self._history[-20:])

        tools = self._build_tools()

        # 循环：LLM 说 text → 发到 /voice/reply；LLM 调 tool → 执行 → 把结果送回 LLM 继续
        while True:
            tool_use_blocks = {}  # {index: {"id": ..., "name": ..., "input_json": ""}}
            current_block_index = -1
            current_block_type = None
            has_text = False

            self.get_logger().info("调用 LLM...")

            try:
                with self.client.messages.stream(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    temperature=self.temperature,
                    system=self.system_prompt,
                    messages=raw_history,
                    tools=tools,
                ) as stream:
                    for event in stream:
                        # ── 一个 block 开始了 ──
                        if event.type == "content_block_start":
                            current_block_index = event.index
                            current_block_type = event.content_block.type

                            if current_block_type == "tool_use":
                                tool_use_blocks[event.index] = {
                                    "id": event.content_block.id,
                                    "name": event.content_block.name,
                                    "input_json": "",
                                }

                        # ── block 的内容增量 ──
                        elif event.type == "content_block_delta":
                            if current_block_type == "text":
                                has_text = True
                                msg = String()
                                msg.data = event.delta.text
                                self.reply_pub.publish(msg)

                            elif current_block_type == "tool_use":
                                blk = tool_use_blocks.get(current_block_index)
                                if blk is not None:
                                    blk["input_json"] += event.delta.partial_json

            except Exception as e:
                self.get_logger().error(f"LLM 请求失败: {e}")
                return

            # ── 处理 Tool Use ──
            if tool_use_blocks:
                # 构建 tool_result 消息
                tool_results = []
                for idx in sorted(tool_use_blocks.keys()):
                    blk = tool_use_blocks[idx]
                    name = blk["name"]
                    try:
                        tool_input = json.loads(blk["input_json"]) if blk["input_json"] else {}
                    except json.JSONDecodeError:
                        tool_input = {}

                    self.get_logger().info(f"执行工具: {name}({tool_input})")
                    result = self._execute_tool(name, tool_input)
                    self.get_logger().info(f"工具结果: {result}")

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": blk["id"],
                        "content": result,
                    })

                # 把 assistant(tool_use) + user(tool_result) 塞进 raw_history，继续循环
                assistant_content = []
                for idx in sorted(tool_use_blocks.keys()):
                    blk = tool_use_blocks[idx]
                    try:
                        inp = json.loads(blk["input_json"]) if blk["input_json"] else {}
                    except json.JSONDecodeError:
                        inp = {}
                    assistant_content.append({
                        "type": "tool_use",
                        "id": blk["id"],
                        "name": blk["name"],
                        "input": inp,
                    })
                raw_history.append({"role": "assistant", "content": assistant_content})
                raw_history.append({"role": "user", "content": tool_results})

                # 继续循环，LLM 拿到工具结果后生成最终回复
                continue

            # ── 纯文本回复，结束 ──
            if has_text:
                # 重建完整文本存入历史（用于后续对话上下文）
                # 这里取巧：重新调一次非流式获取完整文本
                try:
                    full = self.client.messages.create(
                        model=self.model,
                        max_tokens=self.max_tokens,
                        temperature=self.temperature,
                        system=self.system_prompt,
                        messages=raw_history,
                        tools=tools,
                    )
                    reply = ""
                    for block in full.content:
                        if block.type == "text":
                            reply += block.text
                    reply = reply.strip()
                    if reply:
                        with self._lock:
                            self._history.append({"role": "assistant", "content": reply})
                            if len(self._history) > 40:
                                self._history = self._history[-20:]
                        self.get_logger().info(f"回复: {reply}")
                except Exception:
                    pass
            break


def main():
    rclpy.init()
    node = ThinkNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
