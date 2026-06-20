from setuptools import find_packages, setup

package_name = 'voice_system'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='zck',
    maintainer_email='1692930439@qq.com',
    description='语音识别 ROS2 节点：Silero VAD + SenseVoiceSmall 实时语音转文字',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            'listen_node = voice_system.listen_node:main',
        ],
    },
)
