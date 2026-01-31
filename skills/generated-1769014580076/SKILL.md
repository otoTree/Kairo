yaml
---
name: jina_web_collector
description: 从网页收集和提取结构化数据的工具，支持多种内容类型和格式转换
version: 1.0.0
---

# Jina 网页收集器

## 概述

Jina 网页收集器是一个专门用于从网页中提取、收集和结构化数据的工具。它能够智能识别网页内容类型，提取文本、链接、图像等元素，并将结果转换为标准化的数据结构。该工具特别适用于数据采集、内容分析和信息聚合等场景。

主要特性：
- 支持多种网页内容类型的智能识别
- 可配置的提取规则和深度控制
- 自动去重和内容清洗
- 支持并发处理提高效率
- 内置错误处理和重试机制

## 接口规范

### 输入参数

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `urls` | `List[str]` | 是 | - | 要收集的网页URL列表 |
| `max_depth` | `int` | 否 | 1 | 爬取深度（0表示仅当前页） |
| `extract_types` | `List[str]` | 否 | `["text", "links"]` | 要提取的内容类型：text, links, images, metadata |
| `timeout` | `int` | 否 | 30 | 请求超时时间（秒） |
| `concurrent_limit` | `int` | 否 | 3 | 并发请求数量限制 |
| `output_format` | `str` | 否 | "json" | 输出格式：json, csv, markdown |

### 输出结构

```json
{
  "success": true,
  "data": [
    {
      "url": "https://example.com",
      "status": "success",
      "title": "页面标题",
      "content": {
        "text": "提取的文本内容",
        "links": ["链接1", "链接2"],
        "images": ["图片URL1", "图片URL2"],
        "metadata": {"keywords": [], "description": ""}
      },
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ],
  "statistics": {
    "total_urls": 10,
    "successful": 8,
    "failed": 2,
    "total_links": 50,
    "total_images": 15
  },
  "errors": [
    {
      "url": "https://failed.com",
      "error": "连接超时",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  ]
}
```

<chunk id="examples" description="详细使用示例">

## 使用示例

### 示例1：基础网页内容提取

```python
# 提取单个网页的文本和链接
result = main(
    urls=["https://example.com"],
    max_depth=0,
    extract_types=["text", "links"],
    timeout=10,
    concurrent_limit=1,
    output_format="json"
)
```

### 示例2：深度爬取网站内容

```python
# 深度爬取网站，提取所有内容类型
result = main(
    urls=["https://news.example.com"],
    max_depth=2,
    extract_types=["text", "links", "images", "metadata"],
    timeout=30,
    concurrent_limit=3,
    output_format="markdown"
)
```

### 示例3：批量处理多个网站

```python
# 同时处理多个不同网站
urls = [
    "https://tech.example.com",
    "https://blog.example.com",
    "https://docs.example.com"
]

result = main(
    urls=urls,
    max_depth=1,
    extract_types=["text", "metadata"],
    timeout=20,
    concurrent_limit=2,
    output_format="csv"
)
```

### 示例4：仅提取元数据

```python
# 快速获取多个网页的元数据信息
result = main(
    urls=["https://site1.com", "https://site2.com"],
    max_depth=0,
    extract_types=["metadata"],
    timeout=5,
    concurrent_limit=5,
    output_format="json"
)
```

### 示例5：自定义输出格式

```python
# 生成Markdown格式的报告
result = main(
    urls=["https://report.example.com"],
    max_depth=1,
    extract_types=["text", "links", "images"],
    timeout=15,
    concurrent_limit=1,
    output_format="markdown"
)

# 输出结果包含Markdown格式的内容
if result["success"]:
    markdown_content = result["data"][0]["content"]["markdown"]
    print(markdown_content)
```

</chunk>

<chunk id="troubleshooting" description="常见问题与解决方案">

## 故障排除

### 常见错误及解决方法

#### 1. 连接超时错误
**症状**：`"error": "连接超时"` 或 `"status": "timeout"`
**可能原因**：
- 目标服务器响应慢
- 网络连接不稳定
- 防火墙或代理设置问题

**解决方案**：
- 增加 `timeout` 参数值（如从30秒增加到60秒）
- 检查网络连接状态
- 尝试使用不同的并发限制：`concurrent_limit=1`
- 验证URL是否可访问

#### 2. 内容提取失败
**症状**：`"content": {}` 或内容为空
**可能原因**：
- 网页使用JavaScript动态加载内容
- 页面结构不符合预期
- 编码问题

**解决方案**：
- 确认网页在浏览器中正常显示
- 尝试不同的 `extract_types` 组合
- 检查页面源代码，确认目标内容存在
- 考虑使用专门的JavaScript渲染工具（如果可用）

#### 3. 内存使用过高
**症状**：处理大量网页时内存占用持续增长
**可能原因**：
- 并发请求过多
- 提取的内容过大
- 内存泄漏

**解决方案**：
- 降低 `concurrent_limit` 值
- 减少 `max_depth` 设置
- 分批处理URL列表
- 仅提取必要的内容类型

#### 4. 输出格式问题
**症状**：输出格式不符合预期或解析错误
**可能原因**：
- 不支持的输出格式
- 数据包含特殊字符
- 编码不一致

**解决方案**：
- 确认使用支持的输出格式：`json`, `csv`, `markdown`
- 检查数据中的特殊字符处理
- 验证编码设置（默认为UTF-8）

#### 5. 并发限制错误
**症状**：部分请求失败，错误信息包含并发相关提示
**可能原因**：
- 目标服务器限制并发连接
- 本地网络限制
- 资源不足

**解决方案**：
- 降低 `concurrent_limit` 值
- 在请求之间添加延迟
- 分批处理URL

### 性能优化建议

1. **合理设置并发数**：
   - 一般网站：`concurrent_limit=3-5`
   - 高负载网站：`concurrent_limit=1-2`
   - 本地网络：可适当提高

2. **优化提取类型**：
   - 仅提取需要的内容类型
   - 避免不必要的深度爬取
   - 使用 `max_depth=0` 快速测试

3. **批量处理策略**：
   ```python
   # 分批处理大量URL
   batch_size = 10
   all_urls = [...]  # 大量URL列表
   
   for i in range(0, len(all_urls), batch_size):
       batch = all_urls[i:i+batch_size]
       result = main(urls=batch, max_depth=1, concurrent_limit=2)
       # 处理每批结果
   ```

### 调试技巧

1. **启用详细日志**：
   ```python
   import sys
   import logging
   
   logging.basicConfig(
       level=logging.DEBUG,
       format='%(asctime)s - %(levelname)s - %(message)s',
       stream=sys.stderr
   )
   ```

2. **逐步测试**：
   - 从单个URL开始测试
   - 逐步增加复杂度和并发数
   - 验证每个参数的效果

3. **检查返回状态**：
   ```python
   result = main(...)
   
   if not result["success"]:
       print("处理失败", file=sys.stderr)
       for error in result.get("errors", []):
           print(f"URL: {error['url']}, 错误: {error['error']}", file=sys.stderr)
   ```

</chunk>

## 注意事项

1. **遵守robots.txt**：本工具默认遵守目标网站的robots.txt规则
2. **频率限制**：避免对同一网站发送过多请求，建议添加适当延迟
3. **数据存储**：处理敏感数据时确保符合数据保护法规
4. **资源使用**：监控内存和CPU使用，避免影响系统性能
5. **错误处理**：所有错误都会被记录在返回结果的`errors`字段中

## 版本历史

- **1.0.0** (当前版本): 初始发布，支持基础网页内容提取功能
- 支持多种内容类型提取
- 实现并发处理
- 提供多种输出格式
- 完善的错误处理机制

---

*注意：使用本工具时请遵守相关法律法规和目标网站的使用条款。*