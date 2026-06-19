
import time
import pickle

from numpy.polynomial.polynomial import Polynomial
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import ScalarFormatter, FormatStrFormatter

import subprocess
import os
import yaml

model_path= os.path.dirname(os.path.abspath(__file__)).split("range_robot")[0]+"range_robot/src/robot_control/robot_control"
print(f"----------------------------{os.path.dirname(os.path.abspath(__file__))}------------------------------------------")


def caluate_motor_position(angle,file_path):
    if not file_path or file_path=="None":
        return angle
    print("开始转换",model_path+file_path)
    print(type(file_path))
    with open(model_path+file_path, 'rb') as file:
        loaded_coefs1 = pickle.load(file)
    # 使用加载的系数创建多项式对象
    loaded_polynomial1 = Polynomial(loaded_coefs1[::-1])
    # 使用加载的模型进行预测
    # 假设我们想要预测y值为10时的x值
    y_predict1 = angle
    x_predict1 = loaded_polynomial1(y_predict1)
    print(f"f({str(y_predict1)})={str(x_predict1)}")
    return round(x_predict1,2)

    
def map_part(mapping,original_list):
    for topic in original_list:
        if topic not in ["arm","leg","waist","head","ins_left_hand","ins_right_hand"]:
            return "shit"
    # 使用列表推导式进行映射转换
    return [mapping[item] for item in original_list]




def plot_speed_and_effort(node,speed_list, efforts_list,joint_names, save_path="/home/ygsj/workspace/website_v2/range_robot/motor_performance.png", time_window=None):
    """
    绘制每个电机的速度和力矩曲线（双Y轴），确保Y轴对齐
    每个电机独占一行
    
    参数:
        speed_list: 速度数据列表
        efforts_list: 力矩数据列表
        save_path: 图像保存路径 (默认: "motor_performance.png")
        time_window: 显示的时间范围(秒)，例如 (1.0, 3.0) (默认: 全部)
    """

    # 转换 array.array 为普通列表
    converted_speed = []
    for arr in speed_list:
        # 处理空数组的情况
        if len(arr) == 0:
            converted_speed.append([0.0] * len(joint_names))
        else:
            converted_speed.append(arr.tolist())
    speed_list=converted_speed
    converted_effort = []
    for arr in efforts_list:
        if len(arr) == 0:
            converted_effort.append([0.0] * len(joint_names))
        else:
            converted_effort.append(arr.tolist())
    # 检查数据
    if not speed_list or not efforts_list:
        print("警告: 速度列表或力矩列表为空!")
        return
    efforts_list=converted_effort
    if len(speed_list) != len(efforts_list):
        print(f"警告: 速度数据点({len(speed_list)})和力矩数据点({len(efforts_list)})数量不一致!")
    
    # 获取最小数据长度
    min_length = min(len(speed_list), len(efforts_list))
    
    # 转换数据为NumPy数组
    speed_data = np.array(speed_list[:min_length])
    effort_data = np.array(efforts_list[:min_length])
    
    # 确定电机数量
    num_motors = speed_data.shape[1]
    
    # 创建时间轴 (0.005秒间隔)
    time_points = np.arange(min_length) * 0.005
    
    # 设置时间窗口
    if time_window:
        start_idx = max(0, int(time_window[0] / 0.005))
        end_idx = min(min_length, int(time_window[1] / 0.005))
        time_points = time_points[start_idx:end_idx]
        speed_data = speed_data[start_idx:end_idx, :]
        effort_data = effort_data[start_idx:end_idx, :]
    
    # 计算全局Y轴范围（添加5%的边距）
    global_speed_max = np.max(speed_data)
    global_effort_max = np.max(effort_data)

    effort_lim = (-0.2,max(global_speed_max, global_effort_max))
    speed_lim = (-0.2, max(global_speed_max, global_effort_max))
    
    # 创建图形 - 每个电机一行
    fig, axs = plt.subplots(num_motors, 1, figsize=(10, 3 * num_motors))
    
    # 如果只有一个电机，确保axs是可迭代的
    if num_motors == 1:
        axs = [axs]
    
    # 为所有轴创建统一的格式化器
    speed_formatter = ScalarFormatter(useOffset=False)
    speed_formatter.set_scientific(False)
    effort_formatter = ScalarFormatter(useOffset=False)
    effort_formatter.set_scientific(False)
    
    # 为每个电机创建双Y轴图表
    for i in range(num_motors):
        # 主Y轴（速度）
        ax = axs[i]
        ax.plot(time_points, speed_data[:, i], 'b-', linewidth=0.8, label='Speed')
        ax.set_ylabel('Speed', color='b')
        ax.tick_params(axis='y', labelcolor='b')
        
        # 设置统一的Y轴范围
        ax.set_ylim(speed_lim)
        
        # 应用格式化器确保刻度标签宽度一致
        ax.yaxis.set_major_formatter(speed_formatter)
        
        # 次Y轴（力矩）
        ax2 = ax.twinx()
        ax2.plot(time_points, effort_data[:, i], 'r-', linewidth=0.8, label='Effort')
        ax2.set_ylabel('Effort', color='r')
        ax2.tick_params(axis='y', labelcolor='r')
        
        # 设置统一的Y轴范围
        ax2.set_ylim(effort_lim)
        
        # 应用格式化器确保刻度标签宽度一致
        ax2.yaxis.set_major_formatter(effort_formatter)
        
        # 添加标题
        ax.set_title(f'{joint_names[i]} Performance')
        ax.grid(True)
    
    # 添加共享的X轴标签
    fig.text(0.5, 0.04, 'Time (seconds)', ha='center')
    
    # 调整布局并保存
    plt.tight_layout()
    
    # 确保Y轴标签对齐
    fig.align_ylabels(axs)
    
    plt.subplots_adjust(bottom=0.05, hspace=0.4)  # 增加子图间距
    plt.savefig(save_path, dpi=300)
    print(f"电机性能图已保存至: {save_path}")
    plt.close()

