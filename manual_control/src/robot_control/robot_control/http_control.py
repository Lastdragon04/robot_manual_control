import rclpy
from rclpy.node import Node
from fastapi import FastAPI,Request, Depends, HTTPException,Form,File, UploadFile,Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from typing import List,Optional,Union,Dict
from pydantic import BaseModel
import uvicorn
import asyncio
from websockets import serve
import threading
from .db.crud import InvertedIndexSearcher as IIS
from collections import defaultdict
from bodyctrl_msgs.msg import SetMotorPosition,CmdSetMotorPosition
from std_msgs.msg import Header, String
from sensor_msgs.msg import JointState
import json
import os
import time
import fastapi_cdn_host
from datetime import datetime
from .bll import map_part



class FastAPINode(Node):
    def __init__(self):
        super().__init__('fastapi_node')

        self.declare_parameter('dist_path', "/home/zck/workspace/robot_manual_control/dist")
        self.dist_path = self.get_parameter('dist_path').get_parameter_value().string_value

        self.declare_parameter('db_path', "/home/zck/workspace/robot_manual_control/Memories/robot_control_v2.db")
        self.db_path = self.get_parameter('db_path').get_parameter_value().string_value

        self.declare_parameter('models_path', "/home/zck/workspace/robot_manual_control/Models")
        self.models_path = self.get_parameter('models_path').get_parameter_value().string_value

        self.IIS=IIS(self.db_path)
        self.IIS.init_position()
        self.head_pub = self.create_publisher(CmdSetMotorPosition, '/head/cmd_pos', 10)
        self.arm_pub = self.create_publisher(CmdSetMotorPosition, '/arm/cmd_pos', 10)
        self.waist_pub = self.create_publisher(CmdSetMotorPosition, '/waist/cmd_pos', 10)
        self.leg_pub = self.create_publisher(CmdSetMotorPosition, '/leg/cmd_pos', 10)

        self.inspire_hand_left = self.create_publisher(JointState, '/inspire_hand/ctrl/left_hand', 10)
        self.inspire_hand_right = self.create_publisher(JointState, '/inspire_hand/ctrl/right_hand', 10)

        # MCP 同步通知：动作组/动作变更时发布
        self.mcp_notify_pub = self.create_publisher(String, 'mcp_tools_reload', 10)
        

        self.ALLOWED_PARTS={"arm":[],"head":[]}
        self.pub={"head":self.head_pub,"arm":self.arm_pub ,"waist":self.waist_pub,"leg":self.leg_pub,"ins_left_hand":self.inspire_hand_left,"ins_right_hand":self.inspire_hand_right}
        self.parts_name={"arm":"手臂","leg":"腿","waist":"腰","head":"头","ins_left_hand":"左手（因时）","ins_right_hand":"右手（因时）"} 
        self.part_busy={"arm":False,"leg":True,"waist":False,"head":True,"ins_left_hand":False,"ins_right_hand":False} 
        self.declare_parameter('server_port', 3754)
        self.server_port = self.get_parameter('server_port').get_parameter_value().integer_value
        self.circulate=False
        self.app = FastAPI()

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],  # 允许所有来源，可以根据需要调整
            allow_credentials=True,
            allow_methods=["*"],  # 允许所有方法，可以根据需要调整
            allow_headers=["*"],  # 允许所有头，可以根据需要调整
        )
        fastapi_cdn_host.patch_docs(self.app)
        self.setup_routes(self.dist_path)
        self.server_thread = threading.Thread(target=self.run_server)
        self.server_thread.start()

    def _publish(self, msg, part):
        """发布消息，动态创建未注册的 publisher"""
        if part not in self.pub:
            msg_type = type(msg)
            self.pub[part] = self.create_publisher(msg_type, part, 10)
            self.get_logger().info(f"动态创建 Publisher: topic={part}, type={msg_type.__name__}")
        try:
            self.pub[part].publish(msg)
            return True
        except Exception as e:
            self.get_logger().error(f"ERROR:part {e} is not exit")
            return False

    

    def _create_msg(self, command, part: str = 'arm') -> Union[JointState, CmdSetMotorPosition]:
        """创建关节控制消息，严格匹配SetMotorPosition类型要求
        
        Args:
            command: 电机控制指令列表
            part: 控制部位，支持 "arm", "leg", "waist", "head", "ins_left_hand", "ins_right_hand"
        
        Returns:
            对应类型的控制消息
        """
        # 创建消息头
        header = Header()
        header.stamp = self.get_clock().now().to_msg()
        header.frame_id = part
        
        # 手柄控制部分
        if part in ["ins_left_hand", "ins_right_hand"]:
            msg = JointState()
            msg.header = header
            
            # 使用字典映射而不是硬编码偏移量
            offset_map = {
                "ins_left_hand": 70,
                "ins_right_hand": 80
            }
            offset = offset_map[part]
            
            msg.name = [str(item.name_index - offset) for item in command]
            
            # 验证并设置position值
            positions = []
            for item in command:
                value = float(item.value)
                if value < 0.0 or value > 1.0:
                    raise ValueError(
                        f"Position value {value} for part '{part}' is out of range [0.0, 1.0]. "
                        f"Command item: name_index={item.name_index}, value={item.value}"
                    )
                positions.append(value)
            
            msg.position = positions
            return msg
        
        # 身体部位控制部分（arm/leg/waist/head + 动态 topic 均使用 CmdSetMotorPosition）
        else:
            msg = CmdSetMotorPosition()
            msg.header = header
            msg.cmds = []

            for data in command:
                motor_cmd = SetMotorPosition()
                motor_cmd.name = data.name_index  # 关节ID（整数）
                motor_cmd.pos = float(data.value)  # 位置（float类型）
                motor_cmd.spd = float(data.speed)  # 速度（float类型）
                motor_cmd.cur = float(data.current) # 电流（float类型，考虑设为可配置参数）
                msg.cmds.append(motor_cmd)

            return msg

    def _update_positions(self, command, db):
        name_indices = [item.name_index for item in command]
        values = [item.value for item in command]
        db.update_position(name_indices, values)

    def make_action_simple(self, cmd, db):
        try:
            for part_name, data in cmd.items():
                message = self._create_msg(data, part=part_name)
                self.get_logger().info(f"发布:{part_name}|{str(message)}")
                self._publish(message, part_name)
                self._update_positions(data, db)
            return True
        except Exception as e:
            print(e)
            return False

    def _notify_mcp(self, change_type: str, group_id: int = None):
        """通知 MCP Server 动作组有变更"""
        data = {"type": change_type}
        if group_id is not None:
            data["group_id"] = group_id
        msg = String()
        msg.data = json.dumps(data)
        self.mcp_notify_pub.publish(msg)
        self.get_logger().debug(f"已通知 MCP: {data}")

    def get_db(self) -> IIS:
        return self.IIS

    def setup_routes(self, dist_path):
        # @self.app.post("/speak")
        # async def speak(text:str=Form(...)):
        #     try:
        #         self.ser_speaker.send_data(data=text)
        #     except Exception as e:
        #         self.get_logger().info("语音合成模块线松了")
        #     return "success"

        # 创建一个路由来接收上传的文件

        class CommandModel(BaseModel):
            value: float
            speed: float
            part: str
            name_index: int
            current: float

        class GroupRunModel(BaseModel):
            group_id: int
            cycle: bool = False
            start_from: float = 0.0

        class ActionRunModel(BaseModel):
            part: str
            cmd: List[CommandModel]

        class ActionChangeModel(BaseModel):
            action_name: str
            group_id: int
            track: int = 1
            command: List[CommandModel]
            start_time: float = 0.0
            duration: float = 2.0

        class ActionPositionModel(BaseModel):
            action_id: int
            track: int
            start_time: float

        class ActionDurationModel(BaseModel):
            action_id: int
            duration: float

        class ResetCurrentModel(BaseModel):
            control_ids: List[int]
            parts: List[str]

        @self.app.get("/")
        async def index():
            with open(dist_path + "/index.html", "r") as file:
                html_content = file.read()
            return HTMLResponse(content=html_content)

        @self.app.get("/control/get_all")
        async def get_all_control(robot_id: int = Query(1), db: IIS = Depends(self.get_db)):
            try:
                topics, part_names = db.get_allmodules(robot_id)
                motors = db.get_all_control_config(robot_id)
                return {"topic": topics, "motors": motors, "part_names": part_names}
            except Exception as e:
                print(e)
                return {"topic": [], "motors": [], "part_names": []}

        @self.app.get("/robot/get_all")
        def robot_get_all(db: IIS = Depends(self.get_db)):
            robots = db.get_all_robots()
            return {"robots": robots}

        @self.app.post("/control/run")
        def control_run(cmd:List[CommandModel],db:IIS=Depends(self.get_db)):
            commands = defaultdict(list)
            for item in cmd:
                commands[item.part].append(item)
            result=self.make_action_simple(commands, db)
            if result:
                return {"message":"success"}
            else:
                return {"message":"执行失败"}

        # ==================== 动作组 API ====================

        @self.app.post("/action_group/add")
        def action_group_add(name: str = Form(...), action_callback: str = Form(None),
                             description: str = Form(...), robot_id: int = Form(1),
                             db: IIS = Depends(self.get_db)):
            db.insert_action_group(name, action_callback, description, robot_id)
            self._notify_mcp("action_groups_changed")
            return {"message": "success"}

        @self.app.get("/action_group/get_all")
        def get_all_action_group(robot_id: int = Query(None), db: IIS = Depends(self.get_db)):
            groups = db.query_all_action_group(robot_id)
            return {"groups": groups}

        @self.app.delete("/action_group/delete")
        def delete_action_groups(group_id: int = Form(...), db: IIS = Depends(self.get_db)):
            try:
                db.delete_action_group(group_id)
                self._notify_mcp("action_groups_changed")
                return {"message": "success"}
            except Exception:
                return {"message": "failed"}

        @self.app.put("/action_group/modify")
        def action_group_modify(
            group_id: int = Form(...),
            name: str = Form(...),
            action_callback: str = Form(None),
            description: str = Form(...),
            robot_id: int = Form(1),
            db: IIS = Depends(self.get_db),
        ):
            try:
                db.update_action_group(group_id, name, action_callback, description, robot_id)
                self._notify_mcp("action_groups_changed")
                return {"message": "修改成功"}
            except Exception as e:
                return {"message": str(e)}

        @self.app.post("/action_group/run")
        def action_group_run(form: GroupRunModel, db: IIS = Depends(self.get_db)):
            """时间轴多轨道执行，支持 start_from 从指定时间开始"""
            self.get_logger().info(f"时间轴执行 | {datetime.now().strftime('%H:%M:%S.%f')} | start_from={form.start_from}")
            all_actions = db.query_cmds_sorted_by_time(form.group_id)
            if not all_actions:
                return {"message": "动作组为空"}
            # 过滤掉 start_from 之前已结束的动作
            actions = [a for a in all_actions if a["start_time"] + a["duration"] > form.start_from]
            if not actions:
                return {"message": "没有需要执行的动作"}
            max_end = max(a["start_time"] + a["duration"] for a in actions)
            self.circulate = form.cycle

            while True:
                start_wall = time.time() - form.start_from  # 虚拟起始点
                for action in actions:
                    elapsed = time.time() - start_wall
                    wait = action["start_time"] - elapsed
                    if wait > 0.001:
                        time.sleep(wait)
                    if action["command"]:
                        self.make_action_simple(action["command"], db)
                elapsed_total = time.time() - start_wall
                if max_end - elapsed_total > 0.001:
                    time.sleep(max_end - elapsed_total)
                if not self.circulate:
                    break
            return {"message": "执行完毕"}

        @self.app.post("/action_group/stop")
        def action_group_stop():
            self.circulate = False
            return {"message": "已暂停"}

        # ==================== 动作 API（时间轴模型） ====================

        @self.app.get("/action/get_all")
        def get_all_action(group_id: int = Query(...), db: IIS = Depends(self.get_db)):
            timeline = db.get_action_timeline(group_id)
            group = db.query_action_group_by_id(group_id)
            return {"timeline": timeline, "group": group}

        @self.app.post("/action/add")
        def action_add(action: ActionChangeModel, db: IIS = Depends(self.get_db)):
            command = defaultdict(list)
            for item in action.command:
                command[item.part].append(dict(item))
            command_json = json.dumps(command)
            # 如果前端没传 duration 或为默认值，后端推算
            duration = action.duration
            if duration <= 0 or duration == 2.0:
                calculated = db.calculate_duration(command_json, action.group_id)
                if calculated:
                    duration = calculated
            db.insert_action(action.action_name, action.group_id, action.track,
                             command_json, action.start_time, duration)
            self._notify_mcp("action_changed", action.group_id)
            return {"message": "success", "duration": duration}

        @self.app.get("/action/get")
        def get_action(action_id: int = Query(...), db: IIS = Depends(self.get_db)):
            action = db.get_action_modify_bar(action_id, self.parts_name)
            return {"action": action}

        @self.app.post("/action/run")
        def action_run(data: Dict[str, List[CommandModel]], db: IIS = Depends(self.get_db)):
            self.make_action_simple(data, db)
            return {"message": "success"}

        @self.app.delete("/action/delete")
        def action_delete(action_id: int = Form(...), db: IIS = Depends(self.get_db)):
            db.delete_action(action_id)
            self._notify_mcp("action_changed")
            return {"message": "success"}

        @self.app.put("/action/modify")
        def action_modify(form: ActionChangeModel, db: IIS = Depends(self.get_db)):
            """修改动作，action_id 通过 query 传递"""
            return {"message": "请使用 /action/update 接口"}

        @self.app.put("/action/update")
        def action_update(
            action_id: int = Form(...),
            action_name: str = Form(...),
            track: int = Form(1),
            start_time: float = Form(0.0),
            duration: float = Form(2.0),
            command: str = Form("{}"),
            db: IIS = Depends(self.get_db),
        ):
            # 根据新 command 和同组前序位置重算 duration
            act = db.query_action_by_id(action_id)
            gid = act.get("group_id") if act else None
            new_duration = db.calculate_duration(command, gid)
            db.update_action(action_id, action_name, command, track, start_time, new_duration)
            self._notify_mcp("action_changed", gid)
            return {"message": "success", "duration": new_duration}

        @self.app.put("/action/batch_save")
        def action_batch_save(group_id: int = Form(...), actions: str = Form(...),
                              db: IIS = Depends(self.get_db)):
            """批量保存时间轴上的所有动作（先删后插）"""
            try:
                action_list = json.loads(actions)
                saved = db.batch_save_actions(group_id, action_list)
                self._notify_mcp("action_changed", group_id)
                return {"message": "success", "actions": saved}
            except Exception as e:
                return {"message": str(e)}

        @self.app.put("/action/update_position")
        def action_update_position(form: ActionPositionModel, db: IIS = Depends(self.get_db)):
            """拖拽更新动作在时间轴上的位置"""
            db.update_action_position(form.action_id, form.track, form.start_time)
            self._notify_mcp("action_changed")
            return {"message": "success"}

        @self.app.put("/action/update_duration")
        def action_update_duration(form: ActionDurationModel, db: IIS = Depends(self.get_db)):
            """手动调整动作时长"""
            db.update_action_duration(form.action_id, form.duration)
            self._notify_mcp("action_changed")
            return {"message": "success"}

        @self.app.put("/action/recalculate_duration")
        def action_recalculate_duration(action_id: int = Form(...), db: IIS = Depends(self.get_db)):
            """重新推算动作时长"""
            act = db.query_action_by_id(action_id)
            if not act:
                return {"message": "动作不存在"}
            command_json = json.dumps(db.get_raw_action_command(action_id) or {})
            duration = db.calculate_duration(command_json, act.get("group_id"))
            db.update_action_duration(action_id, duration)
            self._notify_mcp("action_changed", act.get("group_id"))
            return {"message": "success", "duration": duration}

        @self.app.post("/control/init")
        def control_init(cmd:List[CommandModel], db:IIS=Depends(self.get_db)):
            commands = defaultdict(list)
            for item in cmd:
                item.value = 0.0
                commands[item.part].append(item)
            result = self.make_action_simple(commands, db)
            if result:
                return {"message":"执行完毕"}
            else:
                return {"message":"执行失败"}

        @self.app.post("/control/reset_current")
        def reset_current(form:ResetCurrentModel,db:IIS=Depends(self.get_db)):
            if len(form.parts)!=len(form.control_ids):
                return "parts与control_ids长度不匹配"
            for index in range(len(form.parts)):
                if form.parts[index] not in list(self.ALLOWED_PARTS.keys()):
                    return {"message":"当前仅支持手臂和头部,其他部位恕不支持"}
                self.ALLOWED_PARTS[form.parts[index]].append(form.control_ids[index])
            header = Header()
            header.stamp = self.get_clock().now().to_msg()
            for part,data in self.ALLOWED_PARTS.items():
                header.frame_id = part
                msg = CmdSetMotorPosition()
                msg.header = header
                msg.cmds = []
                for control_id in data:
                    motor_cmd = SetMotorPosition()
                    motor_cmd.name = control_id  # 关节ID（整数）
                    motor_cmd.pos = 0.0  # 位置（float类型）
                    motor_cmd.spd = 0.0  # 速度（float类型）
                    motor_cmd.cur = 0.0  # 电流（float类型，考虑设为可配置参数）
                    msg.cmds.append(motor_cmd)
                self.pub[part].publish(msg)
            return {"message":"success"}

        @self.app.post("/action/record_start")
        def action_record_satrt():
            pass

        # ========== 电机 CRUD ==========
        @self.app.get("/motor/get_all")
        def motor_get_all(robot_id: int = Query(None), db: IIS = Depends(self.get_db)):
            motors = db.get_all_motors(robot_id)
            return {"motors": motors}

        @self.app.get("/motor/get_a_motor")
        def motor_get_a_motor(motor_id: int = Query(...), db: IIS = Depends(self.get_db)):
            motor = db.get_motor_by_id(motor_id)
            return {"motor": motor}

        @self.app.post("/motor/add")
        def motor_add(
            motor_id: int = Form(...),
            can_rx_id: int = Form(...),
            can_tx_id: int = Form(...),
            name: str = Form(...),
            protocol: int = Form(...),
            current_position: float = Form(0.0),
            max_position: float = Form(0.0),
            min_position: float = Form(0.0),
            default_position: float = Form(0.0),
            robot_id: int = Form(1),
            db: IIS = Depends(self.get_db),
        ):
            try:
                db.insert_motor(motor_id, can_rx_id, can_tx_id, name, protocol,
                                current_position, max_position, min_position,
                                default_position, robot_id)
                return {"message": "success"}
            except Exception as e:
                msg = str(e)
                if 'UNIQUE constraint' in msg and 'motor_id' in msg:
                    return {"message": f"电机ID {motor_id} 在当前机器人下已存在，请更换电机ID"}
                return {"message": msg}

        @self.app.put("/motor/modify")
        def motor_modify(
            motor_id: int = Form(...),       # DB row id
            can_rx_id: int = Form(...),
            can_tx_id: int = Form(...),
            name: str = Form(...),
            protocol: int = Form(...),
            current_position: float = Form(0.0),
            max_position: float = Form(0.0),
            min_position: float = Form(0.0),
            default_position: float = Form(0.0),
            boards_motor: int = Form(0),
            robot_id: int = Form(1),
            db: IIS = Depends(self.get_db),
        ):
            try:
                db.update_motor(motor_id, boards_motor, can_rx_id, can_tx_id, name,
                                protocol, current_position, max_position,
                                min_position, default_position, robot_id)
                return {"message": "success"}
            except Exception as e:
                return {"message": str(e)}

        @self.app.delete("/motor/delete")
        def motor_delete(motor_id: int = Form(...), db: IIS = Depends(self.get_db)):
            try:
                db.delete_motor(motor_id)
                return {"message": "success"}
            except Exception as e:
                return {"message": str(e)}

        # ========== 控制器 ==========
        @self.app.get("/controller/get_all")
        def controller_get_all(robot_id: int = Query(1), db: IIS = Depends(self.get_db)):
            controllers = db.get_all_controllers(robot_id)
            return {"controllers": controllers}

        @self.app.get("/controller/get_motor_id")
        def controller_get_motor_id(control_id: int = Query(...), db: IIS = Depends(self.get_db)):
            motor_ids = db.get_controller_motor_id(control_id)
            robot_id = db.get_controller_robot_id(control_id)
            topics = db.get_distinct_topics()
            slaves = []
            # 如果是主节点，返回所有从节点信息
            row = db._execute_query("SELECT slave_id FROM control_config WHERE id = ?", (control_id,))
            if row and row[0][0] == control_id:
                slaves = db._execute_query(
                    "SELECT id, name, name_index, reference_pkl FROM control_config WHERE slave_id = ? AND id != ?",
                    (control_id, control_id))
                slaves = [{"id": s[0], "name": s[1], "name_index": s[2], "depends": s[3]} for s in slaves]
            return {"controller": motor_ids, "robot_id": robot_id, "location": [topics[0] if topics else ""], "slaves": slaves}

        @self.app.get("/controller/get_locations")
        def controller_get_locations(db: IIS = Depends(self.get_db)):
            rows = db.get_all_motors()
            # 返回 [topic, topic, "模块"] 格式
            topics = []
            seen = set()
            for row in rows:
                t = row[3] if row[3] else ""
                if t and t not in seen:
                    seen.add(t)
                    topics.append([t, t, "模块"])
            return topics

        @self.app.post("/controller/add")
        def controller_add(
            control_id: int = Form(...),
            name: str = Form(...),
            location: str = Form(...),
            topic: str = Form(""),
            urdf_name: str = Form(""),
            move_type: int = Form(1),
            motor_id: str = Form(""),
            description: str = Form(""),
            control_mode: int = Form(1),
            current_position: float = Form(0.0),
            max_position: float = Form(0.0),
            min_position: float = Form(0.0),
            default_position: float = Form(0.0),
            offset: float = Form(0.0),
            depends: str = Form(""),
            robot_id: int = Form(2),
            db: IIS = Depends(self.get_db),
        ):
            try:
                if move_type == 1:
                    # 独立控制：slave_id = NULL
                    sql = """INSERT INTO control_config
                             (id, name, name_index, location, topic, current_position,
                              offset, max, min, default_posistion, reference_pkl, robot_id, slave_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)"""
                    db.change(sql, (control_id, name, motor_id, location, topic,
                                    current_position, offset, max_position,
                                    min_position, default_position, depends, robot_id))
                elif move_type == 2:
                    # 协同控制：motor_id 为逗号分隔的多电机 ID
                    motor_ids = [int(x.strip()) for x in motor_id.split(",") if x.strip()]
                    if not motor_ids:
                        return {"message": "协同控制至少需要选择一个电机"}
                    master_id = control_id
                    base_sql = """INSERT INTO control_config
                                  (id, name, name_index, location, topic, current_position,
                                   offset, max, min, default_posistion, reference_pkl, robot_id, slave_id)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""
                    # 1. 插入主节点（name_index=NULL, slave_id=自身id）
                    db.change(base_sql, (master_id, name, None, location, topic,
                                         0.0, offset, max_position, min_position,
                                         default_position, depends, robot_id, master_id))
                    # 2. 解析每个电机的独立依赖 {"motor_id": "file.pkl", ...}
                    motor_depends = {}
                    if depends:
                        try:
                            motor_depends = json.loads(depends)
                        except (json.JSONDecodeError, TypeError):
                            pass
                    # 3. 插入从节点（name_index=电机id, slave_id=主节点id，max/min/default 取自电机）
                    next_id = db.get_max_control_config_id()
                    for i, mid in enumerate(motor_ids):
                        slave_row_id = next_id + 1 + i
                        motor_info = db.get_motor_by_motor_id(mid, robot_id)
                        slave_name = motor_info["name"] if motor_info else f"电机-{mid}"
                        slave_dep = motor_depends.get(str(mid), depends)
                        s_max = motor_info["max_position"] if motor_info else max_position
                        s_min = motor_info["min_position"] if motor_info else min_position
                        s_def = motor_info["default_position"] if motor_info else default_position
                        db.change(base_sql, (slave_row_id, slave_name, str(mid), location, topic,
                                             0.0, offset, s_max, s_min,
                                             s_def, slave_dep, robot_id, master_id))
                else:
                    return {"message": f"未知的控制类型: {move_type}"}
                return {"message": "success"}
            except Exception as e:
                return {"message": str(e)}

        @self.app.put("/controller/modify")
        def controller_modify(
            control_id: int = Form(...),
            name: str = Form(...),
            location: str = Form(...),
            topic: str = Form(""),
            urdf_name: str = Form(""),
            move_type: int = Form(1),
            motor_id: str = Form(""),
            description: str = Form(""),
            control_mode: int = Form(1),
            current_position: float = Form(0.0),
            max_position: float = Form(0.0),
            min_position: float = Form(0.0),
            default_position: float = Form(0.0),
            offset: float = Form(0.0),
            depends: str = Form(""),
            db: IIS = Depends(self.get_db),
        ):
            try:
                db.update_controller(control_id, name, location, topic, urdf_name,
                                     move_type, motor_id, description, control_mode,
                                     current_position, max_position, min_position,
                                     default_position, offset, depends)
                return {"message": "success"}
            except Exception as e:
                return {"message": str(e)}

        @self.app.post("/controller/upload_pkl")
        async def controller_upload_pkl(file: UploadFile = File(...)):
            """上传 .pkl 多项式文件到 Models 目录"""
            if not file.filename.endswith('.pkl'):
                return {"message": "仅支持 .pkl 文件"}
            os.makedirs(self.models_path, exist_ok=True)
            save_path = os.path.join(self.models_path, file.filename)
            content = await file.read()
            with open(save_path, 'wb') as f:
                f.write(content)
            return {"message": "success", "filename": file.filename}

        @self.app.delete("/controller/delete")
        def controller_delete(control_id: int = Form(...), db: IIS = Depends(self.get_db)):
            try:
                db.delete_controller(control_id)
                return {"message": "success"}
            except Exception as e:
                return {"message": str(e)}

        @self.app.post("/controller/compute_slaves")
        def controller_compute_slaves(
            master_value: float = Form(...),
            slave_ids: str = Form(...),  # 逗号分隔的 control_config id 列表
            db: IIS = Depends(self.get_db),
        ):
            """根据主节点 x 值 + 从节点的 .pkl 多项式计算各从节点输出"""
            import pickle as pk
            from numpy.polynomial.polynomial import Polynomial
            pkl_dir = self.models_path
            ids = [int(x.strip()) for x in slave_ids.split(",") if x.strip()]
            results = {}
            for sid in ids:
                row = db._execute_query(
                    "SELECT name_index, reference_pkl FROM control_config WHERE id = ?", (sid,))
                if not row:
                    continue
                name_index, pkl_file = row[0]
                val = master_value  # 默认：y = x
                if pkl_file and pkl_file != "one_to_one.pkl":
                    pkl_path = os.path.join(pkl_dir, pkl_file)
                    if os.path.exists(pkl_path):
                        try:
                            with open(pkl_path, "rb") as f:
                                coefs = pk.load(f)
                            poly = Polynomial(coefs[::-1])
                            val = round(float(poly(master_value)), 4)
                        except Exception:
                            pass
                results[str(sid)] = {"name_index": name_index, "value": val}
            return {"results": results}

        @self.app.get("/control/get_max_control_id")
        def get_max_control_id(db: IIS = Depends(self.get_db)):
            maxid = db.get_max_control_config_id() + 1
            return {"maxid": maxid}

        self.app.mount("/static", StaticFiles(directory=dist_path), name="static")
        templates = Jinja2Templates(directory=dist_path+"/templates")


    def run_server(self):
        uvicorn.run(self.app, host="0.0.0.0", port=self.server_port)


    # async def imu_echo(self,ws):
    #     while True:
    #         joint=self.joint_angle.copy()
    #         joint=json.dumps(joint)
    #         await ws.send(joint)

    # async def imu_angle_websocket(self):
    #     self.get_logger().info("IMU_Anlge_websocket已开启")
    #     async with serve(lambda ws: self.imu_echo(ws,), "0.0.0.0", 1100):
    #         await asyncio.Future()  # run forever

    # def imu_angle_ws(self):
    #     asyncio.run(self.imu_angle_websocket())

def main(args=None):
    rclpy.init(args=args)
    fastapi_node = FastAPINode()
    rclpy.spin(fastapi_node)
    fastapi_node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
