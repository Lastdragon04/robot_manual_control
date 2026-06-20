"""
一键启动所有机器人控制相关节点。

用法:
  ros2 launch start_up base.launch.py
"""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(
            package="robot_control",
            executable="http_control",
            name="http_control",
            output="screen",
        ),
        Node(
            package="brain_system",
            executable="mcp_server",
            name="mcp_server",
            output="screen",
            parameters=[{"robot_name": "天轶2.0Pro"}],
        ),
        Node(
            package="voice_system",
            executable="listen_node",
            name="listen_node",
            output="screen",
        ),
        Node(
            package="brain_system",
            executable="think_node",
            name="think_node",
            output="screen",
        ),
    ])
