import sqlite3
import re
import json

class Command:
    def __init__(self, name_index=None, value=None, speed=None, part=None,current=None):
        self.name_index = name_index if name_index is not None else 0
        self.value = value if value is not None else 0.0
        self.speed = speed if speed is not None else 0.0
        self.part = part if part is not None else ""
        self.current = current if current is not None else 0.0

class ControlBar(Command):
    def __init__(self):
        super().__init__()
        self.location=""
        self.joint_name=""
        self.default=0
        self.max=0
        self.min=0
        self.motor_id=0


class InvertedIndexSearcher:
    def __init__(self, db_path):
        self.db_path = db_path
        self._con = sqlite3.connect(db_path, check_same_thread=False)
        self._con.execute("PRAGMA journal_mode=WAL")
        self._con.execute("PRAGMA foreign_keys=ON")
        self._migrate_action_table()
        self._migrate_action_groups_table()
        self._migrate_control_config()

    def _migrate_action_groups_table(self):
        """给 action_groups 表添加 robot_id 列（如果不存在）"""
        cursor = self._con.cursor()
        cursor.execute("PRAGMA table_info(action_groups)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'robot_id' not in cols:
            cursor.execute("ALTER TABLE action_groups ADD COLUMN robot_id INTEGER DEFAULT 1 REFERENCES robot(id)")

    def _migrate_control_config(self):
        """给 control_config 表添加 slave_id 列（如果不存在）"""
        cursor = self._con.cursor()
        cursor.execute("PRAGMA table_info(control_config)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'slave_id' not in cols:
            # 如果有旧的 control_id 列，先改名
            if 'control_id' in cols:
                cursor.execute("ALTER TABLE control_config RENAME COLUMN control_id TO slave_id")
            else:
                cursor.execute("ALTER TABLE control_config ADD COLUMN slave_id INTEGER DEFAULT NULL")

    def _migrate_action_table(self):
        """重建 action 表为新版时间轴模型（track + start_time + duration），删除旧 seq/gap 列"""
        cursor = self._con.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='action'")
        if not cursor.fetchone():
            self._create_action_table()
            return
        # 检查是否已经是新表结构（有 track 列）
        cursor.execute("PRAGMA table_info(action)")
        cols = [row[1] for row in cursor.fetchall()]
        if 'track' in cols and 'start_time' in cols:
            return  # 已迁移
        # 重建表
        cursor.execute("DROP TABLE IF EXISTS action")
        self._create_action_table()

    def _create_action_table(self):
        sql = """
            CREATE TABLE IF NOT EXISTS action (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                group_id INT,
                name VARCHAR(100),
                track INTEGER DEFAULT 1,
                command VARCHAR(3000),
                start_time REAL DEFAULT 0.0,
                duration REAL DEFAULT 2.0,
                Foreign Key (group_id) REFERENCES action_groups(id)
                    ON DELETE CASCADE
                    ON UPDATE CASCADE
            );
        """
        self.change(sql)

    def _execute_query(self, query, params=None):
        cursor = self._con.cursor()
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            return cursor.fetchall()
        except sqlite3.Error as e:
            raise Exception(e)

    def change(self, query, params=None):
        cursor = self._con.cursor()
        try:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            self._con.commit()
        except sqlite3.Error as e:
            raise Exception(e)

    def init_position(self):
        sql="UPDATE control_config set current_position = 0.0"
        self.change(sql)

    def update_position(self, names, positions):
        cursor = self._con.cursor()
        cursor.execute("BEGIN")
        cursor.executemany(
            "UPDATE control_config SET current_position = ? WHERE name_index = ?",
            [(str(p), str(n)) for p, n in zip(positions, names)]
        )
        self._con.commit()

    def get_allmodules(self, robot_id):
        sql = "SELECT DISTINCT topic, location FROM control_config WHERE robot_id=? ORDER BY topic"
        temp = self._execute_query(sql, (robot_id,))
        topics = []
        locations = []
        if temp:
            for row in temp:
                topics.append(row[0])
                locations.append(row[1] if row[1] else row[0])
        return topics, locations

    def get_all_control_config(self, robot_id=1):
        sql = "SELECT * FROM control_config WHERE robot_id = ? ORDER BY topic"
        rows = self._execute_query(sql, (robot_id,))
        motors = []
        for row in rows:
            motors.append({
                "id": row[0], "name": row[1], "name_index": row[2],
                "location": row[3], "topic": row[4],
                "current_position": row[5], "offset": row[6],
                "max": row[7], "min": row[8],
                "urdf_name": row[9], "default_position": row[10],
                "reference_pkl": row[11], "robot_id": row[12],
                "slave_id": row[13] if len(row) > 13 else None,
            })
        return motors

    def get_all_robots(self):
        sql = "SELECT * FROM robot ORDER BY id"
        return self._execute_query(sql)

    # ========== 电机 CRUD (motor_config 表) ==========
    def get_all_motors(self, robot_id=None):
        if robot_id:
            sql = "SELECT * FROM motor_config WHERE robot_id = ? ORDER BY id"
            rows = self._execute_query(sql, (robot_id,))
        else:
            sql = "SELECT * FROM motor_config ORDER BY id"
            rows = self._execute_query(sql)
        return [self._motor_to_dict(r) for r in rows]

    def _motor_to_dict(self, row):
        return {
            "id": row[0], "motor_id": row[1],
            "can_rx_id": row[2], "can_tx_id": row[3],
            "name": row[4], "protocol": row[5],
            "current_position": row[6], "max_position": row[7],
            "min_position": row[8], "default_position": row[9],
            "robot_id": row[10],
        }

    def get_motor_by_id(self, motor_id):
        sql = "SELECT * FROM motor_config WHERE id = ?"
        result = self._execute_query(sql, (motor_id,))
        return self._motor_to_dict(result[0]) if result else None

    def get_motor_by_motor_id(self, motor_id, robot_id=None):
        if robot_id is not None:
            sql = "SELECT * FROM motor_config WHERE motor_id = ? AND robot_id = ?"
            result = self._execute_query(sql, (motor_id, robot_id))
        else:
            sql = "SELECT * FROM motor_config WHERE motor_id = ?"
            result = self._execute_query(sql, (motor_id,))
        return self._motor_to_dict(result[0]) if result else None

    def insert_motor(self, motor_id, can_rx_id, can_tx_id, name, protocol,
                     current_position, max_position, min_position, default_position,
                     robot_id=1):
        sql = """INSERT INTO motor_config
                 (motor_id, can_rx_id, can_tx_id, name, protocol,
                  current_position, max_position, min_position, default_position,
                  robot_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""
        self.change(sql, (motor_id, can_rx_id, can_tx_id, name, protocol,
                          current_position, max_position, min_position,
                          default_position, robot_id))

    def update_motor(self, row_id, motor_id, can_rx_id, can_tx_id, name, protocol,
                     current_position, max_position, min_position, default_position,
                     robot_id=1):
        sql = """UPDATE motor_config SET motor_id=?, can_rx_id=?, can_tx_id=?,
                 name=?, protocol=?, current_position=?, max_position=?,
                 min_position=?, default_position=?, robot_id=?
                 WHERE id=?"""
        self.change(sql, (motor_id, can_rx_id, can_tx_id, name, protocol,
                          current_position, max_position, min_position,
                          default_position, robot_id, row_id))

    def delete_motor(self, motor_id):
        sql = "DELETE FROM motor_config WHERE id = ?"
        self.change(sql, (motor_id,))

    # ========== 控制器 ==========
    def get_all_controllers(self, robot_id=None):
        """从 control_config 映射为控制器格式，可选按 robot_id 过滤"""
        if robot_id is not None:
            sql = "SELECT * FROM control_config WHERE robot_id = ? ORDER BY id"
            rows = self._execute_query(sql, (robot_id,))
        else:
            sql = "SELECT * FROM control_config ORDER BY id"
            rows = self._execute_query(sql)
        controllers = []
        for row in rows:
            rid = row[0]       # id
            sid = row[13] if len(row) > 13 else None  # slave_id (may not exist pre-migration)
            is_master = (sid is not None and sid == rid)
            is_slave = (sid is not None and sid != rid)
            ctrl_type = 2 if (is_master or is_slave) else 1
            controllers.append({
                "id": rid,
                "name": row[1],
                "location": row[3] if row[3] else "",
                "control_type": ctrl_type,
                "current_position": row[5],
                "max_position": row[7],
                "min_position": row[8],
                "default_position": row[10],
                "motor_id": row[2],
                "depends": row[11] if row[11] else "one_to_one.pkl",
                "description": "",
                "control_mode": 1,
                "topic": row[4],
                "urdf_name": row[9] if row[9] else "",
                "offset": row[6] if row[6] is not None else 0.0,
                "slave_id": sid,
                "is_master": is_master,
                "master_id": sid if is_slave else None,
            })
        return controllers

    def get_max_control_config_id(self):
        """获取 control_config 表中当前最大的 id"""
        result = self._execute_query("SELECT COALESCE(MAX(id), 0) FROM control_config")
        return result[0][0] if result else 0

    def delete_controller(self, control_id):
        """删除控制器。如果是协同主节点，级联删除所有从节点"""
        row = self._execute_query(
            "SELECT slave_id FROM control_config WHERE id = ?", (control_id,))
        if not row:
            raise Exception("Controller not found")
        sid = row[0][0]
        # 如果是主节点（slave_id == 自身id），先删从节点再删自身
        if sid is not None and sid == control_id:
            self.change(
                "DELETE FROM control_config WHERE slave_id = ? AND id != ?",
                (control_id, control_id))
        self.change("DELETE FROM control_config WHERE id = ?", (control_id,))

    def get_controller_motor_id(self, control_id):
        sql = """SELECT m.motor_id FROM control_config c
                 JOIN motor_config m ON c.robot_id = m.robot_id
                 WHERE c.id = ? AND m.motor_id = c.name_index"""
        result = self._execute_query(sql, (control_id,))
        if result:
            return [row[0] for row in result]
        return []

    def update_controller(self, control_id, name, location, topic, urdf_name,
                          move_type, motor_id, description, control_mode,
                          current_position, max_position, min_position,
                          default_position, offset, depends):
        sql = """UPDATE control_config SET name=?, location=?, topic=?, urdf_name=?,
                 current_position=?, max=?, min=?, default_posistion=?, offset=?,
                 reference_pkl=?
                 WHERE id=?"""
        self.change(sql, (name, location, topic, urdf_name, current_position,
                          max_position, min_position, default_position, offset,
                          depends, control_id))

    def get_controller_robot_id(self, control_id):
        sql = "SELECT robot_id FROM control_config WHERE id = ?"
        result = self._execute_query(sql, (control_id,))
        return result[0][0] if result else 2

    def get_distinct_topics(self):
        sql = "SELECT DISTINCT topic FROM control_config ORDER BY topic"
        return [row[0] for row in self._execute_query(sql)]

    # ==================== 动作组 CRUD ====================

    def insert_action_group(self, *params):
        sql = "INSERT INTO action_groups (name, callback, description, robot_id) VALUES (?, ?, ?, ?);"
        self.change(sql, params)

    def query_all_action_group(self, robot_id: int = None):
        if robot_id is not None:
            sql = "SELECT * FROM action_groups WHERE robot_id=?"
            return self._execute_query(sql, (robot_id,))
        sql = "SELECT * FROM action_groups"
        return self._execute_query(sql)

    def query_action_group_by_id(self, group_id):
        sql = "SELECT * FROM action_groups WHERE id=?"
        result = self._execute_query(sql, (group_id,))
        return result[0] if result else None

    def update_action_group(self, group_id, name, callback, description, robot_id):
        sql = "UPDATE action_groups SET name=?, callback=?, description=?, robot_id=? WHERE id=?"
        self.change(sql, (name, callback, description, robot_id, group_id))

    def delete_action_group(self, group_id):
        sql = "DELETE FROM action_groups WHERE id=?"
        self.change(sql, (group_id,))

    # ==================== 动作 CRUD（时间轴模型） ====================

    def query_actions_by_group(self, group_id):
        """获取动作组下所有动作，按 start_time 排序"""
        sql = """SELECT id, group_id, name, track, command, start_time, duration
                 FROM action WHERE group_id=? ORDER BY start_time, track"""
        rows = self._execute_query(sql, (group_id,))
        return [{
            "id": r[0], "group_id": r[1], "name": r[2], "track": r[3],
            "command": r[4], "start_time": r[5], "duration": r[6],
        } for r in rows]

    def query_action_by_id(self, action_id):
        """获取单个动作"""
        sql = "SELECT id, group_id, name, track, command, start_time, duration FROM action WHERE id=?"
        rows = self._execute_query(sql, (action_id,))
        if rows:
            r = rows[0]
            return {"id": r[0], "group_id": r[1], "name": r[2], "track": r[3],
                    "command": r[4], "start_time": r[5], "duration": r[6]}
        return None

    def insert_action(self, name, group_id, track, command, start_time, duration):
        """插入新动作"""
        sql = """INSERT INTO action (name, group_id, track, command, start_time, duration)
                 VALUES (?, ?, ?, ?, ?, ?)"""
        self.change(sql, (name, group_id, track, command, start_time, duration))

    def update_action(self, action_id, name, command, track, start_time, duration):
        """更新动作（名称、命令、轨道、起始时间、时长）"""
        sql = """UPDATE action SET name=?, command=?, track=?, start_time=?, duration=?
                 WHERE id=?"""
        self.change(sql, (name, command, track, start_time, duration, action_id))

    def update_action_position(self, action_id, track, start_time):
        """仅更新动作在时间轴上的位置（拖拽用）"""
        sql = "UPDATE action SET track=?, start_time=? WHERE id=?"
        self.change(sql, (track, start_time, action_id))

    def update_action_duration(self, action_id, duration):
        """手动调整动作时长"""
        sql = "UPDATE action SET duration=? WHERE id=?"
        self.change(sql, (duration, action_id))

    def delete_action(self, action_id):
        """删除动作（时间轴模型无需重排 seq）"""
        sql = "DELETE FROM action WHERE id=?"
        self.change(sql, (action_id,))

    def batch_save_actions(self, group_id, actions):
        """批量保存：先删后插，按序重算 duration，返回新 ID 列表"""
        cursor = self._con.cursor()
        try:
            cursor.execute("BEGIN IMMEDIATE")
            cursor.execute("DELETE FROM action WHERE group_id=?", (group_id,))
            # 按 start_time 排序
            sorted_actions = sorted(actions, key=lambda a: a.get("start_time", 0))
            # 按轨道号数字顺序重新编号（而非 start_time 首次遇到）
            unique_tracks = sorted(set(a.get("track", 1) for a in sorted_actions))
            track_map = {old: new for new, old in enumerate(unique_tracks, start=1)}
            for a in sorted_actions:
                a["track"] = track_map.get(a.get("track", 1), 1)
            saved = []
            prev_positions = {}  # {name_index: value} 累积前序动作的目标位置
            for a in sorted_actions:
                # 基于前序位置重新推算 duration
                recalculated = self._calc_duration_from_prev(
                    a.get("command", "{}"), prev_positions)
                a["duration"] = recalculated
                # 更新累积位置
                try:
                    cmd = json.loads(a.get("command", "{}").replace("'", '"').replace("None", "null"))
                    for part, motor_cmds in cmd.items():
                        for mc in motor_cmds:
                            ni = str(mc.get("name_index", ""))
                            prev_positions[ni] = float(mc.get("value", 0.0))
                except (json.JSONDecodeError, AttributeError):
                    pass
                cursor.execute(
                    """INSERT INTO action (group_id, name, track, command, start_time, duration)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (group_id, a.get("name", ""), a.get("track", 1),
                     a.get("command", "{}"), a.get("start_time", 0.0),
                     a.get("duration", 2.0)))
                a["id"] = cursor.lastrowid
                saved.append(a)
            self._con.commit()
            return saved
        except Exception:
            self._con.rollback()
            raise

    def _calc_duration_from_prev(self, command_json, prev_positions):
        """根据前序累积位置计算时长"""
        try:
            cmd = json.loads(command_json.replace("'", '"').replace("None", "null"))
        except (json.JSONDecodeError, AttributeError):
            return 2.0
        max_dur = 0.0
        for part, motor_cmds in cmd.items():
            for mc in motor_cmds:
                ni = str(mc.get("name_index", ""))
                target = float(mc.get("value", 0.0))
                speed = float(mc.get("speed", 1.0))
                if speed <= 0:
                    speed = 1.0
                prev = float(prev_positions.get(ni, 0.0))
                d = abs(target - prev) / speed
                if d > max_dur:
                    max_dur = d
        return round(max_dur, 2) if max_dur > 0 else 2.0

    def get_action_timeline(self, group_id):
        """获取动作组完整时间轴数据（供前端渲染）"""
        actions = self.query_actions_by_group(group_id)
        # 计算总时长
        max_end = 0.0
        for a in actions:
            end = a["start_time"] + a["duration"]
            if end > max_end:
                max_end = end
        # 解析每个动作涉及的身体部位（从 command JSON 中提取）
        for a in actions:
            try:
                cmd = json.loads(a["command"].replace("'", '"').replace("None", "null"))
                a["parts"] = list(cmd.keys())
            except (json.JSONDecodeError, AttributeError):
                a["parts"] = []
        return {"actions": actions, "total_duration": max_end}

    def _get_motor_prev_position(self, group_id, name_index):
        """查找同组内上一个动作对该电机的目标位置（按 start_time 排序）"""
        sql = """SELECT command FROM action
                 WHERE group_id=? AND id IN (
                   SELECT id FROM action WHERE group_id=? ORDER BY start_time
                 )"""
        rows = self._execute_query(sql, (group_id, group_id))
        # 遍历所有动作，找到最后一个提及该 name_index 的目标值
        last_value = None
        for (cmd_str,) in rows:
            try:
                cmd = json.loads(cmd_str.replace("'", '"').replace("None", "null"))
            except (json.JSONDecodeError, AttributeError):
                continue
            for part, motor_cmds in cmd.items():
                for mc in motor_cmds:
                    if str(mc.get("name_index", "")) == str(name_index):
                        last_value = float(mc.get("value", 0.0))
        # 如果同组没有，回退到 control_config 的当前值
        if last_value is None:
            cur = self._execute_query(
                "SELECT current_position FROM control_config WHERE name_index=?",
                (str(name_index),))
            if cur:
                last_value = float(cur[0][0])
        return last_value if last_value is not None else 0.0

    def calculate_duration(self, command_json: str, group_id: int = None) -> float:
        """根据 command 中的 speed 和参考位置推算动作时长（仅供参考）
        优先用同组前一个动作的目标位置，没有则用 control_config 当前位置"""
        try:
            cmd = json.loads(command_json.replace("'", '"').replace("None", "null"))
        except (json.JSONDecodeError, AttributeError):
            return 2.0
        max_duration = 0.0
        for part, motor_cmds in cmd.items():
            for mc in motor_cmds:
                name_index = mc.get("name_index", 0)
                target_value = abs(float(mc.get("value", 0.0)))
                speed = float(mc.get("speed", 1.0))
                if speed <= 0:
                    speed = 1.0
                if group_id is not None:
                    current_pos = self._get_motor_prev_position(group_id, name_index)
                else:
                    cur = self._execute_query(
                        "SELECT current_position FROM control_config WHERE name_index=?",
                        (str(name_index),))
                    current_pos = float(cur[0][0]) if cur else 0.0
                motor_duration = abs(target_value - current_pos) / speed
                if motor_duration > max_duration:
                    max_duration = motor_duration
        return round(max_duration, 2) if max_duration > 0 else 2.0

    # ==================== 动作组执行（时间轴模型） ====================

    def query_cmds_sorted_by_time(self, group_id):
        """按 start_time 排序获取所有动作的命令（供执行用），返回 Command 对象列表"""
        sql = """SELECT command, start_time, duration, track FROM action
                 WHERE group_id=? ORDER BY start_time"""
        rows = self._execute_query(sql, (group_id,))
        result = []
        for row in rows:
            try:
                cmd_dict = json.loads(row[0].replace("'", '"').replace("None", "null"))
            except (json.JSONDecodeError, AttributeError):
                cmd_dict = {}
            # 将 dict 转为 {part: [Command, ...]} 格式
            cmd_with_objects = {}
            for part, motor_cmds in cmd_dict.items():
                cmd_with_objects[part] = [Command(**mc) for mc in motor_cmds]
            result.append({
                "command": cmd_with_objects,
                "start_time": row[1],
                "duration": row[2],
                "track": row[3],
            })
        return result

    # ==================== 辅助方法（保留） ====================

    def get_shit_by_name_index(self, name_index, robot_id=None):
        if robot_id is not None:
            sql = """SELECT id, name, topic, min, max, urdf_name FROM control_config WHERE name_index = ? AND robot_id = ?"""
            result = self._execute_query(sql, (name_index, robot_id))
        else:
            sql = """SELECT id, name, topic, min, max, urdf_name FROM control_config WHERE name_index = ?"""
            result = self._execute_query(sql, (name_index,))
        if result:
            return result[0]
        else:
            return None, None, None, None, None, None

    def get_action_modify_bar(self, action_id, mapping):
        """获取动作编辑栏数据（保留兼容老接口）"""
        action = self.query_action_by_id(action_id)
        if not action:
            return None
        # 从 action_groups 获取 robot_id，确保 name_index 查找时按机器人过滤
        group = self.query_action_group_by_id(action["group_id"])
        robot_id = group[4] if group and len(group) > 4 else None
        try:
            temp = json.loads(action["command"].replace("'", '"').replace("None", "null"))
        except (json.JSONDecodeError, AttributeError):
            return action
        control_bars = []
        for part, commands in temp.items():
            for cmd in commands:
                control_bar = ControlBar()
                motor_id, motor_name, topic, min_pos, max_pos, urdf_name = self.get_shit_by_name_index(cmd["name_index"], robot_id)
                control_bar.motor_id = motor_id
                control_bar.joint_name = motor_name
                control_bar.location = mapping.get(topic, topic)
                control_bar.name_index = cmd["name_index"]
                control_bar.position = cmd.get("value", 0.0)
                control_bar.speed = cmd.get("speed", 0.0)
                control_bar.efforts = cmd.get("current", 0.0)
                control_bar.part = cmd.get("part", part)
                control_bar.default = 0
                control_bar.min = min_pos
                control_bar.max = max_pos
                control_bars.append(control_bar)
        action["command"] = control_bars
        return action

    def get_raw_action_command(self, action_id):
        """获取原始 command JSON"""
        sql = "SELECT command FROM action WHERE id = ?"
        result = self._execute_query(sql, (action_id,))
        if result:
            try:
                return json.loads(result[0][0].replace("'", '"').replace("None", "null"))
            except (json.JSONDecodeError, AttributeError):
                return {}
        return None


if __name__ == "__main__":
    searcher = InvertedIndexSearcher('/home/zck/workspace/robot_manual_control/Memories/robot_control_v2.db')
    a = searcher.query_cmd_by_group_id(5)
    for action in a:
        for part_cmds in action:
            for part, cmds in part_cmds.items():
                for cmd in cmds:
                    print(cmd.name_index, cmd.value)