import requests
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

urls = [
    'https://example.com/video_01.mp4',
    'https://example.com/video_02.mp4',
    'https://example.com/video_03.mp4',
    'https://example.com/video_04.mp4',
    'https://example.com/video_05.mp4',
    'https://example.com/video_06.mp4',
    'https://example.com/video_07.mp4',
    'https://example.com/video_08.mp4',
    'https://example.com/video_09.mp4',
    'https://example.com/video_10.mp4',
    'https://example.com/video_11.mp4',
    'https://example.com/video_12.mp4',
    'https://example.com/video_13.mp4',
    'https://example.com/video_14.mp4',
    'https://example.com/video_15.mp4'
]

target_dir = './workspace/videos'
if not os.path.exists(target_dir):
    os.makedirs(target_dir)

def download_video(idx, url):
    filename = os.path.join(target_dir, f'video_{idx+1:02d}.mp4')
    try:
        print(f'正在下载视频 {idx+1}/15: {url[:50]}...')
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        downloaded = 0
        
        with open(filename, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
        
        file_size = os.path.getsize(filename)
        print(f'视频 {idx+1}/15 下载完成: {filename} ({file_size} 字节)')
        return idx, True, filename, None
    except Exception as e:
        print(f'视频 {idx+1}/15 下载失败: {e}')
        return idx, False, None, str(e)

print(f'开始下载 {len(urls)} 个视频到目录: {target_dir}')
start_time = time.time()

results = []
with ThreadPoolExecutor(max_workers=5) as executor:
    future_to_idx = {executor.submit(download_video, idx, url): idx for idx, url in enumerate(urls)}
    for future in as_completed(future_to_idx):
        idx, success, filename, error = future.result()
        results.append((idx, success, filename, error))

end_time = time.time()
elapsed = end_time - start_time

success_count = sum(1 for _, success, _, _ in results if success)
failed_count = len(results) - success_count

print(f'\n下载完成! 总共耗时: {elapsed:.2f} 秒')
print(f'成功: {success_count}, 失败: {failed_count}')

if failed_count > 0:
    print('失败的视频:')
    for idx, success, _, error in results:
        if not success:
            print(f'  视频 {idx+1}: {error}')

print('\n下载的文件列表:')
for file in os.listdir(target_dir):
    filepath = os.path.join(target_dir, file)
    size = os.path.getsize(filepath)
    print(f'  {file} ({size} 字节)')
