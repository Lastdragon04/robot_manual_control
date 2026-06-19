cmake_minimum_required(VERSION 3.5)
project(robot_msg)

# Default to C99
if(NOT CMAKE_C_STANDARD)
  set(CMAKE_C_STANDARD 99)
endif()

# Default to C++14
if(NOT CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 14)
endif()

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(std_msgs REQUIRED)

set(msg_files
  "msg/CanBusData.msg"
  "msg/MotorDriverData.msg"
  "msg/MotorDriverMessage.msg"
  "msg/SerialData.msg"
  "msg/ImuAngle.msg"
  "msg/ImuGyro.msg"
  "msg/ImuAcc.msg"
  "srv/CacheSet.srv"
  "srv/CacheGet.srv"
  "srv/ImuRectify.srv"
)
rosidl_generate_interfaces(${PROJECT_NAME}
  ${msg_files}
  DEPENDENCIES std_msgs
 )
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  find_package(std_msgs REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()
ament_package()
