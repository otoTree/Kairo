import subprocess
import sys

# 尝试不同的命令来获取监听端口
commands = [
    "lsof -i -P -n | grep LISTEN",
    "netstat -an | grep LISTEN",
    "ss -tuln"
]

print("正在获取当前运行的端口信息...\n")

for cmd in commands:
    print(f"尝试命令: {cmd}")
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            print(f"成功执行命令 '{cmd}':\n")
            print(result.stdout)
            break
        elif result.stderr:
            print(f"错误: {result.stderr[:200]}")
    except subprocess.TimeoutExpired:
        print(f"命令 '{cmd}' 执行超时")
    except Exception as e:
        print(f"执行命令 '{cmd}' 时出错: {e}")
    print("-" * 50)

# 如果上面的命令都失败了，尝试使用Python的socket模块
print("\n尝试使用Python socket模块检查常见端口...")
import socket

common_ports = [80, 443, 3000, 5000, 5432, 6379, 8080, 9000]
local_ports = []

for port in common_ports:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.1)
    result = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    if result == 0:
        local_ports.append(port)

if local_ports:
    print(f"检测到本地服务在以下端口运行: {local_ports}")
else:
    print("未检测到常见端口的本地服务")
