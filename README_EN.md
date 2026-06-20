<p align="left">
    <a href="README.md">中文</a>&nbsp ｜ &nbspEnglish
</p>
<br>

<p align="center">
  <strong>HTTP-to-ROS2 Robot Control Platform</strong>
</p>

<p align="center">
  A general-purpose web-based remote control middleware for humanoid robots,<br>built on ROS2 Humble and FastAPI
</p>

<p align="center">
  <img src="https://img.shields.io/badge/ROS2-Humble-22314e?logo=ros" alt="ROS2">
  <img src="https://img.shields.io/badge/Python-3.10+-3776ab?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.100+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Ubuntu-22.04-e95420?logo=ubuntu" alt="Ubuntu">
  <img src="https://img.shields.io/badge/Frontend-jQuery%20%2B%20Bootstrap%204-7952b3" alt="Frontend">
</p>

---

## Project Vision

**Core Purpose**: Lower the debugging barrier for robotics development — a universal web console that lets developers remotely control and debug any robot in real time.

**Ultimate Goal**: Adapt to all robots on the market and become a universal robot control middleware, not limited to specific models.

**Current Stage**: Supports Tiangong 2.0Plus, Tiangong 2.0Pro, and Tianyi 2.0Pro series, providing a complete toolchain from low-level motor debugging and motion choreography to gait training.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Robot Framework | ROS2 Humble, `bodyctrl_msgs`, `sensor_msgs` |
| Backend | FastAPI + uvicorn (HTTP :3754) |
| Database | SQLite (WAL mode), native `sqlite3` module (SQLAlchemy ORM deprecated) |
| Frontend | jQuery 3.7 + Bootstrap 4.6 + ECharts 5 (SPA, `dist/`) |
| Scientific | NumPy, Matplotlib |
| URDF | Full URDF models for Tiangong 2.0Pro / Tianyi 2.0Pro |

## Architecture (API-Driven + Voice) ★

```
┌──────────────────────────────────────────────────────┐
│         Anthropic API (Primary) / Claude Code (Aux)   │
│  • Primary: think_node calls API directly + Tool Use  │
│  • Auxiliary: Claude Code → MCP Server (debugging)    │
└───────────────────────┬──────────────────────────────┘
                        │ Anthropic API / MCP (SSE)
┌───────────────────────▼──────────────────────────────┐
│          brain_system (Brain) ★NEW                    │
│  mcp_server (SSE :9876): MCP→HTTP proxy (aux channel)│
│  think_node: LLM chat + Tool Use → /voice/reply      │
└───────────────────────────┬──────────────────────────┘
                            │
┌───────────────┐          │          ┌─────────────────┐
│ voice_system  │   /voice/text    │  Browser (SPA)   │
│ listen_node   │───→  ┌─┴──┐ ←──│  /ws/events bus  │
│ VAD + ASR     │     │    │     │  Left/Bottom-right  │
└───────────────┘     └────┘     └────────┬────────────┘
                                         │ HTTP + WS
┌────────────────────────────────────────▼─────────────┐
│           robot_control (ROS2 Node)                   │
│  FastAPI + uvicorn (:3754) + WebSocket                │
│  • REST API — motor/controller/action CRUD            │
│  • ROS2 Publishers → /head, /arm, /waist, /leg, hands│
│  • WebSocket /ws/events → voice/tool/reply events    │
└───────────────────────────┬───────────────────────────┘
                            │ ROS2 Topic
┌───────────────────────────▼───────────────────────────┐
│          joint_description (ROS2 Node)                 │
│  JointHub — Joint State Manager                       │
│  • Interpolated smooth motion from commands           │
│  • Publishes /joint_states at 20Hz, RViz support      │
└───────────────────────────┬───────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────┐
│               SQLite (WAL Mode)                        │
│  robot / motor_config / control_config                │
│  action_groups / action / words                       │
└───────────────────────────────────────────────────────┘
```

## Demo

Execute an action group from the web console, with the robot responding in real time in RViz:

![Action group demo](README_source/demo.gif)

## Core Features

### 1. Real-time Motor & Coordinated Control ★

- Grouped by body part (head/arms/waist/legs/dexterous hands), independently controlled
- **Coordinated Control**: Master node provides input value x; slave nodes compute target positions via polynomials f(x) for multi-joint linkage
- Tunable three-loop parameters: position (pos), speed (spd), current (cur)
- Online status indicators, real-time WebSocket updates
- Multi-motor batch selection, execution, and homing

### 2. Timeline Action Choreography ★ Refactored 2026/06

- **Multi-track parallelism**: Actions on different tracks execute concurrently
- **Drag & drop editing**: Move blocks, resize duration from right edge, drag to empty space to auto-create tracks
- **Breakpoint playback**: Click the ruler to set a breakpoint; execution starts from the marked position
- **Playhead**: `requestAnimationFrame`-driven real-time playhead with snap guides
- **Dirty/save mode**: Local edits → batch commit; green pulsing save button when unsaved
- Loop / single-shot execution, emergency stop

### 3. Motor Configuration Management

- Full motor parameter CRUD: CAN ID, protocol type, mechanical limits, default position
- Polynomial fitting dependency (.pkl files) for uncalibrated joint angle mapping
- Dynamic multi-robot switching (loaded from `/robot/get_all`)

### 4. Controller Management

- Independent / Coordinated control modes
- Master node (virtual, blue highlighted) manages a group of slave nodes
- Slave nodes auto-indented, non-editable individually
- .pkl file upload & management

### 5. Action Groups & Voice Knowledge Base

- Action group CRUD + run/stop
- Voice command → action group mapping (`words` table)
- Text response and action execution modes

### 6. MCP Server — Claude AI Robot Control ★

- **Auto Tool Mapping**: Action groups loaded from DB on startup, each auto-registered as an MCP Tool
- **Zero Hard-coding**: Add/modify action groups without changing code; auto-reload via `mcp_tools_reload`
- **HTTP Proxy Mode**: `mcp_server` delegates execution to `http_control` via HTTP
- **Robot Isolation**: `robot_name` parameter filters which robot's action groups are exposed
- Supports loop execution (`cycle`) and breakpoint start (`start_from`)

![mcp动作调用演示](README_source/mcp演示.gif)

**Launch**:
```bash
ros2 run brain_system mcp_server --ros-args -p robot_name:=Tianyi2.0Pro -p port:=9876
```

**Claude Code Config**:
```bash
claude mcp add robot -- ros2 run brain_system mcp_server --ros-args -p robot_name:=Tianyi2.0Pro
```

	![MCP action demo](README_source/mcp演示.gif)

	Voice conversation calling MCP, TTS not yet implemented.

### 7. Voice System (voice_system) ★NEW

- **Real-time ASR**: pyaudio → Silero VAD → SenseVoiceSmall → `/voice/text`
- **In-memory**: Audio passed as numpy array, no disk writes
- **Topics**: `/voice/text` (recognized text), `/voice/status` (idle/speaking/recognizing)
- **Launch**: `ros2 run voice_system listen_node`

### 8. Brain System (brain_system) ★NEW — API-Driven Primary

- **Autonomous**: `think_node` calls Anthropic API directly — no dependency on Claude Code
- **LLM Chat**: Subscribes `/voice/text` → Anthropic API (DeepSeek) streaming → `/voice/reply`
- **Tool Use**: Action groups auto-converted to Anthropic Tool format, LLM calls tools naturally
- **Auxiliary Channel**: `mcp_server` exposes MCP for Claude Code debugging
- **Launch**: `ros2 run brain_system think_node`

### 9. Event Bus (WebSocket) ★NEW

`/ws/events` pushes three event types to browser:

| Event | Source | Position | Color |
|-------|--------|----------|-------|
| User speech | `/voice/text` | Bottom-left | Blue |
| Tool call | `/voice/tool` | Bottom-right | Orange |
| AI reply | `/voice/reply` | Bottom-right | Green |

### 10. One-Click Launch (start_up) ★NEW

	```bash
	ros2 launch robot_description display.launch.py
	```

```bash
ros2 launch start_up base.launch.py
```

## Core Database Tables

### robot — Robot Models
| id | name |
|----|------|
| 1  | Tiangong 2.0Plus |
| 2  | Tiangong 2.0Pro |
| 3  | Tianyi 2.0Pro |

### motor_config — Motor Configuration
| Column | Description |
|--------|-------------|
| motor_id | Motor ID on CAN bus (composite unique key) |
| can_rx_id / can_tx_id | CAN receive/transmit IDs |
| name | Motor name |
| protocol | Protocol (0=none, 1=Qiu, 2=Laoding, 3=Step) |
| current/max/min/default_position | Position parameters |
| robot_id | FK → robot |

### control_config — Controller ★
| Column | Description |
|--------|-------------|
| name | Joint / controller name |
| topic | ROS2 Topic |
| name_index | FK → motor_config.motor_id |
| urdf_name | URDF joint name |
| **slave_id** | ★ NULL=independent, =own id=master, =other id=slave |
| reference_pkl | Polynomial .pkl filename |

**Coordinated Control Model**: Master provides x → each slave i computes output via f_i(x) = y_i.

### action_groups / action — Timeline Actions ★ Refactored 2026/06

| Table | Key Columns | Notes |
|-------|-------------|-------|
| action_groups | name, description, callback, robot_id | Action groups |
| action | track, start_time, duration, command(JSON) | Multi-track parallel actions |

**Execution Model**: Sorted by start_time, supports breakpoint start, server-side unified execution.

## REST API

<details>
<summary><b>Motor Management</b> — click to expand</summary>

| Method | Path | Description |
|--------|------|-------------|
| GET | `/motor/get_all?robot_id=X` | List motors |
| GET | `/motor/get_a_motor?motor_id=X` | Get single motor |
| POST | `/motor/add` | Add motor |
| PUT | `/motor/modify` | Update motor |
| DELETE | `/motor/delete` | Delete motor |

</details>

<details>
<summary><b>Controller Management</b> — click to expand</summary>

| Method | Path | Description |
|--------|------|-------------|
| GET | `/controller/get_all?robot_id=X` | List controllers |
| GET | `/controller/get_motor_id?control_id=X` | Get linked motor + slaves |
| POST | `/controller/add` | Add (supports coordinated control) |
| PUT | `/controller/modify` | Update |
| DELETE | `/controller/delete` | Delete (cascades to slaves) |
| POST | `/controller/compute_slaves` | Compute slave f(x) values |
| POST | `/controller/upload_pkl` | Upload .pkl file |

</details>

<details>
<summary><b>Action Groups & Actions</b> — click to expand</summary>

| Method | Path | Description |
|--------|------|-------------|
| GET | `/action_group/get_all` | List all action groups |
| POST | `/action_group/add` | Create action group |
| DELETE | `/action_group/delete` | Delete |
| POST | `/action_group/run` | Execute timeline (cycle, start_from) |
| POST | `/action_group/stop` | Stop execution |
| GET | `/action/get_all?group_id=X` | Get timeline data |
| POST | `/action/add` | Add action (auto-computes duration) |
| PUT | `/action/update` | Full update |
| DELETE | `/action/delete` | Delete |
| PUT | `/action/batch_save` | Batch save (sort→recalc→renumber→delete+insert) |

</details>

<details>
<summary><b>Motor Control & Robot</b> — click to expand</summary>

| Method | Path | Description |
|--------|------|-------------|
| GET | `/control/get_all?robot_id=X` | Get control center data |
| POST | `/control/run` | Execute motor command |
| POST | `/control/init` | Home selected motors |
| POST | `/control/reset_current` | Reset motor current |
| GET | `/robot/get_all` | List all robot models |

</details>

## Quick Start

### Prerequisites

- Ubuntu 22.04
- ROS2 Humble
- Python 3.10+

### Installation

```bash
# 1. Install Python dependencies
pip install -r requirement.txt

# 2. Build ROS2 workspace
cd /path/to/http_to_ros
colcon build --symlink-install
source install/setup.bash
```

### Run

```bash
cd /path/to/http_to_ros
export ROS_DOMAIN_ID=0
source install/setup.bash

# Start HTTP control service (includes ROS2 node)
ros2 run robot_control http_control

# Optional: Start joint state manager (RViz visualization)
ros2 run joint_description joint_hub

# Optional: Launch URDF model display
ros2 launch robot_description display.launch.py
```

Open `http://<robot-ip>:3754` in your browser.

### ROS2 Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `dist_path` | `/home/zck/workspace/http_to_ros/dist` | Frontend static files |
| `db_path` | `.../Memories/robot_control_v2.db` | SQLite database path |
| `server_port` | 3754 | HTTP server port |
| `models_path` | `.../Models` | .pkl polynomial file directory |

### Robot Mode Requirements

- **Tiangong 2.0 series**: Must switch to `motion_control` mode; supports distributed communication via Ethernet
- **Tianyi 2.0 series**: Must be deployed on the robot's onboard computer (unless DDS is configured)

## Directory Structure

```
http_to_ros/
├── dist/                              # Frontend SPA
│   ├── index.html                     # Entry point (all pages in one file)
│   ├── js/apis.js                     # Core business logic
│   ├── js/script.js                   # UI events, DOM interaction
│   ├── js/voice.js                    # Voice control
│   ├── css/styles.css                 # Custom styles
│   └── bootstrap-4.6.2-dist/
├── Models/                            # .pkl polynomial file storage
├── manual_control/src/
│   ├── robot_control/robot_control/   # Main control package
│   │   ├── http_control.py            # FastAPI + ROS2 entry point
│   │   ├── bll.py                     # Business logic
│   │   ├── schemas_models.py          # Pydantic models
│   │   └── db/crud.py                 # Data access layer
│   ├── brain_system/brain_system/     # Brain ★NEW
│   │   ├── mcp_server.py              # MCP Server (SSE :9876)
│   │   └── think_node.py              # LLM chat + Tool Use
│   ├── voice_system/voice_system/     # Voice I/O ★NEW
│   │   └── listen_node.py             # VAD + ASR
│   ├── start_up/                      # One-click launch ★NEW
│   │   └── launch/base.launch.py
│   ├── joint_description/             # Joint state manager
│   ├── joint_description/             # Joint state manager
│   ├── robot_description/             # Robot URDF + Launch (display.launch.py)
│   ├── tiangong2pro_urdf/             # Tiangong 2.0Pro URDF
│   ├── tianyi2_urdf/                  # Tianyi 2.0Pro URDF
│   ├── bodyctrl_msgs/                 # Custom ROS2 message package
│   ├── robot_interfaces/              # Robot interface definitions
│   ├── robot_msg/                     # Robot message types
│   └── lite_urdf_publish/             # Lightweight URDF publisher
├── test/                              # Test scripts
├── Memories/                          # SQLite database files
├── start.sh                           # One-click start script
└── requirement.txt                    # Python dependencies
```

## Key Dependencies

`fastapi` `uvicorn` `matplotlib` `jinja2` `python-multipart` `numpy` `pymysql` (unused)

---

## License

This project is for educational and research purposes only.

## Contact

**Author**: zck  
**Email**: 1692930439@qq.com  
**Phone**: +86 19987400216
