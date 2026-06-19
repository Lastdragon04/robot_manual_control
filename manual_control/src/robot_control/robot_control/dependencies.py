from .db.database import get_db_session,Session #session给其他调用
from types import SimpleNamespace
from robot_msg.msg import MotorDriverMessage,MotorDriverData
import time
from datetime import datetime

def get_db():
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()

def wait_action_done(redis_cli,motor_candis):
    print("执行中")
    while True:

        if all(int(redis_cli.get("CAN-"+str(i))) == 1 for i in motor_candis):
            print(motor_candis)
            break  # 如果所有结果都是1，则退出while循环
        time.sleep(0.005)  # 等待一段时间再进行下一次检查
    print("执行完毕")

def make_action_simple(node,cmd):
    canids=[]
    motor_message=MotorDriverMessage()
    motor_message.data=[]
    for command in cmd:
        if type(command)==dict:
            command=SimpleNamespace(**command)
        if command.depend and command.depend!="null":
            depend=command.depend
        else:
            depend=''
        motor_data=MotorDriverData()
        motor_data.canid=command.canid
        motor_data.value=command.value
        motor_data.speed=command.speed
        motor_data.type=command.type
        motor_data.protocol_type=command.protocol_type
        motor_data.boards_motor=command.boards_motor
        motor_data.depend=depend
        motor_data.bus=command.bus
        motor_message.data.append(motor_data)
        canids.append(command.canid)
        node.redis_cli.set("CAN-"+str(command.canid),2)
    node.motor_control.publish(motor_message)
    node.get_logger().info(str(canids)+f"{datetime.now().strftime('%H:%M:%S.%f')}")
    wait_action_done(node.redis_cli,canids)