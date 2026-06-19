from sys import executable
from launch.actions import LogInfo
from launch import LaunchDescription
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.actions import Node
from launch.substitutions import Command
import os
from ament_index_python.packages import get_package_share_path

def generate_launch_description():
    urdf_path = os.path.join(get_package_share_path('tianyi2_urdf'),
                             'urdf','tianyi2.0_complete_with_hands.xacro')
    rviz_config_path = os.path.join(get_package_share_path('robot_description'),
                                    'rviz', 'zhengong.rviz')
    
    robot_description = ParameterValue(Command(['xacro ',urdf_path]),value_type=str)
    robot_state_publisher_node = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        parameters=[{"robot_description":robot_description}]
    )

    rviz2_node = Node(
        package="rviz2",
        executable="rviz2",
        arguments = ['-d', rviz_config_path]
    )

    joint_description = Node(
        package="joint_description",
        executable="joint_hub",
        arguments = ['-d', rviz_config_path]
    )

    return LaunchDescription([
        LogInfo(msg=f"[INFO] URDF path: {urdf_path}"),
        robot_state_publisher_node,
        joint_description,
        # joint_state_publisher_gui_node,
        # can_imu_publisher,
        rviz2_node
    ])

