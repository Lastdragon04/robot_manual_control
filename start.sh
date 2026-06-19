#!/usr/bin/env bash
set -e

# ============================================
# HTTP-to-ROS2 一键启动脚本
# 分别打开三个终端窗口运行:
#   1. http_control   — FastAPI + ROS2 控制节点
#   2. joint_hub      — 关节状态管理 + /joint_states 发布
#   3. display.launch  — URDF 模型 + RViz 可视化
# ============================================

WORKSPACE_DIR="$(cd "$(dirname "$0")" && pwd)"
echo $WORKSPACE_DIR
SETUP_FILE="$WORKSPACE_DIR/manual_control/install/setup.bash"

if [ ! -f "$SETUP_FILE" ]; then
    echo "[ERROR] 未找到 $SETUP_FILE"
    echo "       请先执行: cd $WORKSPACE_DIR && colcon build --symlink-install"
    exit 1
fi

SOURCE_CMD="source /opt/ros/humble/setup.bash && source $SETUP_FILE && export ROS_DOMAIN_ID=0"

launch_terminal() {
    local title="$1"
    local cmd="$2"

    if command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title="$title" -- bash -c "$SOURCE_CMD && echo '[$(date +%H:%M:%S)] $title 启动...' && $cmd; exec bash"
    elif command -v konsole &>/dev/null; then
        konsole --new-tab -p tabtitle="$title" -e bash -c "$SOURCE_CMD && echo '[$(date +%H:%M:%S)] $title 启动...' && $cmd; exec bash"
    elif command -v xterm &>/dev/null; then
        xterm -title "$title" -e bash -c "$SOURCE_CMD && echo '[$(date +%H:%M:%S)] $title 启动...' && $cmd; exec bash" &
    elif command -v xfce4-terminal &>/dev/null; then
        xfce4-terminal --title="$title" -- bash -c "$SOURCE_CMD && echo '[$(date +%H:%M:%S)] $title 启动...' && $cmd; exec bash"
    else
        echo "[ERROR] 未找到支持的终端模拟器 (gnome-terminal/konsole/xterm/xfce4-terminal)"
        exit 1
    fi
}

echo "============================================"
echo " HTTP-to-ROS2 启动中..."
echo " Workspace: $WORKSPACE_DIR"
echo "============================================"

launch_terminal "http_control"     "ros2 run robot_control http_control"
launch_terminal "joint_hub"        "ros2 run joint_description joint_hub"
launch_terminal "display_launch"   "ros2 launch robot_description display.launch.py"

echo "三个窗口已启动。"
