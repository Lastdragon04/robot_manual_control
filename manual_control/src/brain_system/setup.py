from setuptools import find_packages, setup

package_name = 'brain_system'

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
    description='机器人大脑决策系统：意图路由、LLM对话、MCP客户端',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            "mcp_server = brain_system.mcp_server:main",
            "think_node = brain_system.think_node:main"
        ],
    },
)
