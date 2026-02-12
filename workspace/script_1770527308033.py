import subprocess
import sys

# 尝试安装requests
print('正在安装requests模块...')
try:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'requests'])
    print('requests模块安装成功！')
except Exception as e:
    print(f'安装失败: {e}')
    # 尝试使用pip3
    try:
        subprocess.check_call(['pip3', 'install', 'requests'])
        print('使用pip3安装成功！')
    except Exception as e2:
        print(f'pip3安装也失败: {e2}')
        print('请手动安装requests模块: pip install requests')