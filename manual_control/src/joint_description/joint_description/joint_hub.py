import rclpy
from rclpy.node import Node
from threading import Lock
from typing import Dict, List, Tuple
from .db.crud import InvertedIndexSearcher
from .joint_status import urdf_joints
from sensor_msgs.msg import JointState
from bodyctrl_msgs.msg import CmdSetMotorPosition, SetMotorPosition
from std_msgs.msg import Header
import time
import threading
import asyncio
import json
from websockets import serve

class JointHub(Node):
    def __init__(self):
        super().__init__('joint_hub')
        self.declare_parameter('db_path', "/home/zck/workspace/robot_manual_control/Memories/robot_control_v2.db")
        self.declare_parameter('robot_type', "天轶2.0Pro")

        # 发布器
        self._publisher = self.create_publisher(JointState, "/joint_states", 10)

        # 获取参数
        self.db_path = self.get_parameter('db_path').get_parameter_value().string_value
        self.robot_type = self.get_parameter('robot_type').get_parameter_value().string_value
        
        # 验证机器人类型
        if self.robot_type not in urdf_joints:
            self.get_logger().error(f"未知的机器人类型: {self.robot_type}")
            self.get_logger().info(f"可用的机器人类型: {list(urdf_joints.keys())}")
            raise ValueError(f"未知的机器人类型: {self.robot_type}")
        
        # 获取该机器人类型的关节列表
        self.joint_names = urdf_joints[self.robot_type]
        self.get_logger().info(f"机器人类型: {self.robot_type}, 关节数量: {len(self.joint_names)}")
        
        # 初始化数据库连接
        self.db = InvertedIndexSearcher(self.db_path)
        
        # 使用锁保护共享数据
        self.joint_lock = Lock()
        
        # 初始化关节位置字典和ID映射
        self.joint_positions: Dict[str, float] = {}
        self.joint_id_to_name: Dict[int, str] = {}
        self.joint_name_to_id: Dict[str, int] = {}
        
        # 手部关节（预留）
        self.hand_joints: Dict[str, float] = {}
        
        # 新增：目标位置、速度、运动状态
        self.joint_targets: Dict[str, float] = {}
        self.joint_speeds: Dict[str, float] = {}
        self.joint_moving: Dict[str, bool] = {}
        
        # 从数据库初始化关节信息
        self.init_joint_info_from_db()
        
        # 确保所有关节都有初始值
        self.ensure_all_joints_initialized()
        
        # 创建订阅
        self.create_subscriptions()
        
        # 创建定时器发布关节状态
        self.publish_time_gap = 0.1
        self.create_timer(self.publish_time_gap, self.publish_joint_states)  # 20Hz
        
        # 初始化发布计数器
        self.publish_counter = 0

        # WebSocket 电机状态推送 (port 8765)
        self._ws_clients = set()
        self._ws_loop = None
        self._ws_ready = threading.Event()
        self._ws_thread = threading.Thread(target=self._run_ws_server, daemon=True)
        self._ws_thread.start()

        self.get_logger().info('JointHub已启动')
        self.get_logger().info(f"关节ID映射: {self.joint_id_to_name}")

    def init_joint_info_from_db(self):
        """从数据库初始化关节信息和ID映射"""
        try:
            db_joints = self.db.get_joint_position(self.robot_type)
            
            with self.joint_lock:
                for joint_name, position, joint_id_str in db_joints:
                    try:
                        # 确保关节名在关节列表中
                        if joint_name not in self.joint_names:
                            self.get_logger().warn(f"数据库中的关节名 '{joint_name}' 不在关节列表中")
                            continue
                        
                        # 转换ID为整数
                        joint_id = int(joint_id_str)
                        
                        # 存储关节位置
                        self.joint_positions[joint_name] = float(position)
                        
                        # 存储双向映射
                        self.joint_id_to_name[joint_id] = joint_name
                        self.joint_name_to_id[joint_name] = joint_id
                        
                        self.get_logger().debug(f"从数据库加载关节: {joint_name} (ID: {joint_id}), 位置: {position}")
                        
                    except (ValueError, TypeError) as e:
                        self.get_logger().error(f"处理关节数据时出错: {joint_name}, {position}, {joint_id_str}: {e}")
            
            self.get_logger().info(f"从数据库加载了 {len(self.joint_positions)}/{len(self.joint_names)} 个关节")
            
        except Exception as e:
            self.get_logger().error(f"从数据库初始化关节信息失败: {e}")

    def ensure_all_joints_initialized(self):
        """确保所有关节都有初始值"""
        with self.joint_lock:
            for joint_name in self.joint_names:
                if joint_name not in self.joint_positions:
                    # 为未初始化的关节设置默认值
                    self.joint_positions[joint_name] = 0.0
                    self.get_logger().debug(f"设置默认值: {joint_name} = 0.0")

    def create_subscriptions(self):
        """创建所有订阅"""
        # 身体部位订阅（CmdSetMotorPosition消息）
        body_topics = [
            ('/head/cmd_pos', self.head_callback),
            ('/arm/cmd_pos', self.arm_callback),
            ('/waist/cmd_pos', self.waist_callback),
            ('/leg/cmd_pos', self.leg_callback),
        ]
        
        for topic, callback in body_topics:
            self.create_subscription(
                CmdSetMotorPosition,
                topic,
                callback,
                10
            )
            self.get_logger().info(f"创建订阅: {topic}")
        
        # 手部订阅（JointState消息）- 预留
        hand_topics = [
            ('/inspire_hand/ctrl/left_hand', self.left_hand_callback),
            ('/inspire_hand/ctrl/right_hand', self.right_hand_callback),
        ]
        
        for topic, callback in hand_topics:
            self.create_subscription(
                JointState,
                topic,
                callback,
                10
            )
            self.get_logger().info(f"创建手部订阅: {topic}")

    def process_cmd_set_motor_position(self, msg: CmdSetMotorPosition, part_name: str):
        """处理CmdSetMotorPosition消息 - 设置目标位置和速度，不创建线程"""
        if not msg.cmds:
            self.get_logger().warn(f"收到空的{part_name}控制命令")
            return
        
        self.get_logger().info(f"收到{part_name}控制命令，包含 {len(msg.cmds)} 个关节")
        
        updated_joints = []
        
        with self.joint_lock:
            for cmd in msg.cmds:
                joint_id = cmd.name
                joint_name = self.joint_id_to_name.get(joint_id)
                
                if joint_name:
                    old_position = self.joint_positions.get(joint_name, 0.0)
                    new_position = float(cmd.pos)
                    speed = float(cmd.spd)
                    
                    # 设置目标位置和速度，标记开始运动
                    self.joint_targets[joint_name] = new_position
                    self.joint_speeds[joint_name] = speed
                    self.joint_moving[joint_name] = True
                    
                    updated_joints.append((joint_name, old_position, new_position))
                    
                    # 记录详细信息
                    self.get_logger().info(
                        f"更新关节: {joint_name} (ID: {joint_id}), "
                        f"位置: {old_position:.3f} -> {new_position:.3f}, "
                        f"速度: {speed}, 电流: {cmd.cur}"
                        f"所需时间:{abs((new_position-old_position)/speed):.3f}"
                    )
                else:
                    self.get_logger().debug(f"收到未映射的关节ID: {joint_id}，位置: {cmd.pos}")
        
        if updated_joints:
            change_summary = ", ".join([f"{name}:{old:.3f}->{new:.3f}" for name, old, new in updated_joints[:3]])
            if len(updated_joints) > 3:
                change_summary += f" ... 共{len(updated_joints)}个关节"
            self.get_logger().info(f"{part_name}关节更新: {change_summary}")

    def head_callback(self, msg: CmdSetMotorPosition):
        """头部关节回调"""
        self.process_cmd_set_motor_position(msg, "头部")

    def arm_callback(self, msg: CmdSetMotorPosition):
        """手臂关节回调"""
        self.process_cmd_set_motor_position(msg, "手臂")

    def waist_callback(self, msg: CmdSetMotorPosition):
        """腰部关节回调"""
        self.process_cmd_set_motor_position(msg, "腰部")

    def leg_callback(self, msg: CmdSetMotorPosition):
        """腿部关节回调"""
        self.process_cmd_set_motor_position(msg, "腿部")

    def left_hand_callback(self, msg: JointState):
        """左手回调（预留）"""
        self.get_logger().info(f"收到左手控制命令: {len(msg.name) if msg.name else 0}个关节")

    def right_hand_callback(self, msg: JointState):
        """右手回调（预留）"""
        self.get_logger().info(f"收到右手控制命令: {len(msg.name) if msg.name else 0}个关节")

    def update_hand_joints(self, msg: JointState, hand_type: str):
        """更新手部关节（预留接口）"""
        if not msg.name or not msg.position:
            return
        
        with self.joint_lock:
            for joint_name_str, position in zip(msg.name, msg.position):
                hand_joint_name = f"{hand_type}_{joint_name_str}"
                self.hand_joints[hand_joint_name] = float(position)
                self.get_logger().debug(f"更新手部关节 {hand_joint_name}: {position}")

    def publish_joint_states(self):
        """发布关节状态，同时更新运动关节的位置"""
        with self.joint_lock:
            dt = self.publish_time_gap

            # 更新所有正在运动的关节
            for joint_name in self.joint_names:
                if self.joint_moving.get(joint_name, False):
                    current = self.joint_positions[joint_name]
                    target = self.joint_targets[joint_name]
                    speed = self.joint_speeds[joint_name]

                    # 如果速度为零或已到达目标附近（容忍误差），直接设为目标并停止
                    if speed == 0.0 or abs(current - target) < 1e-6:
                        self.joint_positions[joint_name] = target
                        self.joint_moving[joint_name] = False
                        continue

                    # 确定运动方向
                    direction = 1.0 if target > current else -1.0
                    step = speed * dt * direction

                    # 检查是否会越过目标
                    if (direction > 0 and current + step >= target) or \
                       (direction < 0 and current + step <= target):
                        # 直接设为目标并停止运动
                        self.joint_positions[joint_name] = target
                        self.joint_moving[joint_name] = False
                    else:
                        # 正常步进
                        self.joint_positions[joint_name] = current + step

            # 构建并发布关节状态消息
            msg = JointState()
            msg.header = Header()
            msg.header.stamp = self.get_clock().now().to_msg()
            msg.header.frame_id = f'joint_hub_{self.publish_counter}'
            
            joint_names = []
            joint_positions = []
            
            # 添加身体关节
            for joint_name in self.joint_names:
                position = self.joint_positions.get(joint_name, 0.0)
                joint_names.append(joint_name)
                joint_positions.append(float(position))
            
            # 添加手部关节（预留）
            for hand_joint_name, position in self.hand_joints.items():
                joint_names.append(hand_joint_name)
                joint_positions.append(float(position))
            
            msg.name = joint_names
            msg.position = joint_positions
            msg.velocity = [0.0] * len(joint_names)
            msg.effort = [0.0] * len(joint_names)
            
            self._publisher.publish(msg)
            self.publish_counter += 1

        # 广播电机状态到前端 (锁外调用)
        self._broadcast_motor_status()

    def get_joint_state_by_name(self, joint_name: str) -> float:
        with self.joint_lock:
            return self.joint_positions.get(joint_name, 0.0)

    def get_joint_state_by_id(self, joint_id: int) -> float:
        with self.joint_lock:
            joint_name = self.joint_id_to_name.get(joint_id)
            if joint_name:
                return self.joint_positions.get(joint_name, 0.0)
            return 0.0

    def set_joint_position_by_name(self, joint_name: str, position: float) -> bool:
        with self.joint_lock:
            if joint_name in self.joint_positions:
                self.joint_positions[joint_name] = float(position)
                return True
            return False

    def set_joint_position_by_id(self, joint_id: int, position: float) -> bool:
        with self.joint_lock:
            joint_name = self.joint_id_to_name.get(joint_id)
            if joint_name and joint_name in self.joint_positions:
                self.joint_positions[joint_name] = float(position)
                return True
            return False

    def _run_ws_server(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._ws_loop = loop
        self._ws_ready.set()
        loop.run_until_complete(self._ws_main())

    async def _ws_main(self):
        async def handler(ws):
            self._ws_clients.add(ws)
            self.get_logger().info(f"WebSocket 客户端已连接，当前连接数: {len(self._ws_clients)}")
            try:
                # 连接时立即发送当前所有电机状态
                with self.joint_lock:
                    status_list = [[jid, 2 if self.joint_moving.get(jname, False) else 1]
                                   for jid, jname in self.joint_id_to_name.items()]
                if status_list:
                    await ws.send(json.dumps(status_list))
                    self.get_logger().info(f"已发送初始状态: {len(status_list)} 个关节")
                else:
                    self.get_logger().warn("关节状态列表为空，未发送初始数据")
                async for _ in ws:
                    pass
            except Exception as e:
                self.get_logger().warn(f"WebSocket handler 异常: {e}")
            finally:
                self._ws_clients.discard(ws)
                self.get_logger().info(f"WebSocket 客户端已断开，当前连接数: {len(self._ws_clients)}")

        async with serve(handler, "0.0.0.0", 8765):
            await asyncio.Future()

    def _broadcast_motor_status(self):
        if not self._ws_clients or not self._ws_ready.is_set():
            return
        with self.joint_lock:
            status_list = [[jid, 2 if self.joint_moving.get(jname, False) else 1]
                           for jid, jname in self.joint_id_to_name.items()]
        if not status_list:
            return
        data = json.dumps(status_list)
        for ws in list(self._ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(self._ws_send(ws, data), self._ws_loop)
            except Exception as e:
                self.get_logger().error(f"WebSocket 广播调度失败: {e}")

    async def _ws_send(self, ws, data):
        try:
            await ws.send(data)
        except Exception as e:
            self.get_logger().warn(f"WebSocket 发送失败，移除客户端: {e}")
            self._ws_clients.discard(ws)

def main(args=None):
    rclpy.init(args=args)
    try:
        joint_hub = JointHub()
        rclpy.spin(joint_hub)
        joint_hub.destroy_node()
    except Exception as e:
        print(f"启动JointHub失败: {e}")
    finally:
        rclpy.shutdown()

if __name__ == '__main__':
    main()