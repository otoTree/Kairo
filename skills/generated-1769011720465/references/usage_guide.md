---
name: jina_multi_page_summarizer
description: 使用Jina AI的多页面内容总结工具，能够从多个网页URL提取并汇总内容，生成结构化的总结文档
version: 1.0.0
---

# Jina多页面总结汇总器

## 概述

`jina_multi_page_summarizer` 是一个智能的多页面内容总结工具，专门设计用于从多个网页URL中提取关键信息，并生成结构化的总结文档。该工具利用Jina AI的技术能力，能够高效处理多个网页内容，提取核心信息，并按照用户指定的格式进行汇总。

主要特性：
- **多页面并行处理**：同时处理多个网页URL，提高效率
- **智能内容提取**：自动识别和提取网页中的主要内容
- **结构化输出**：生成格式良好的Markdown或文本总结文档
- **可定制化**：支持自定义总结长度、输出格式等参数

## 接口

### 输入参数

| 参数名 | 类型 | 必填 | 描述 | 默认值 |
|--------|------|------|------|--------|
| `urls` | `List[str]` | 是 | 需要总结的网页URL列表 | - |
| `output_format` | `str` | 否 | 输出格式（"markdown" 或 "text"） | "markdown" |
| `summary_length` | `str` | 否 | 总结长度（"short", "medium", "detailed"） | "medium" |
| `include_metadata` | `bool` | 否 | 是否包含元数据（标题、URL等） | True |
| `language` | `str` | 否 | 输出语言（"zh", "en"等） | "zh" |

### 输出结构

工具返回一个字典，包含以下字段：

```python
{
    "status": "success" | "error",
    "summary": str,  # 生成的总结文档内容
    "processed_count": int,  # 成功处理的URL数量
    "failed_urls": List[str],  # 处理失败的URL列表
    "total_pages": int,  # 总URL数量
    "execution_time": float  # 执行时间（秒）
}
```

<chunk id="examples" description="详细的使用示例和代码演示">

## 示例

### 基础使用示例

```python
# 导入技能
from src.main import main

# 准备输入参数
input_data = {
    "urls": [
        "https://example.com/article1",
        "https://example.com/article2",
        "https://example.com/blog/post1"
    ],
    "output_format": "markdown",
    "summary_length": "medium",
    "include_metadata": True,
    "language": "zh"
}

# 执行总结
result = main(**input_data)

# 处理结果
if result["status"] == "success":
    print(f"成功处理 {result['processed_count']}/{result['total_pages']} 个页面")
    print("生成的总结：")
    print(result["summary"])
    
    if result["failed_urls"]:
        print(f"失败的URL：{result['failed_urls']}")
else:
    print("处理失败")
```

### 高级配置示例

```python
# 使用详细总结和纯文本格式
input_data = {
    "urls": [
        "https://news.example.com/tech-article",
        "https://research.example.com/paper"
    ],
    "output_format": "text",
    "summary_length": "detailed",
    "include_metadata": False,
    "language": "en"
}

result = main(**input_data)
```

### 批量处理示例

```python
# 处理大量URL
urls_to_process = [
    f"https://docs.example.com/page{i}" for i in range(1, 11)
]

input_data = {
    "urls": urls_to_process,
    "output_format": "markdown",
    "summary_length": "short",
    "include_metadata": True,
    "language": "zh"
}

result = main(**input_data)
print(f"处理完成，用时 {result['execution_time']:.2f} 秒")
```

</chunk>

<chunk id="troubleshooting" description="常见问题解决和错误处理指南">

## 故障排除

### 常见错误及解决方案

#### 1. 网络连接问题
**症状**：`failed_urls` 列表包含多个URL，执行时间异常长
**可能原因**：
- 网络连接不稳定
- 目标网站不可访问
- 防火墙或代理设置问题

**解决方案**：
- 检查网络连接
- 验证URL是否可访问
- 分批处理大量URL，减少单次请求数量

#### 2. 内容提取失败
**症状**：某些页面返回空总结或格式错误的内容
**可能原因**：
- 网页使用JavaScript动态加载内容
- 页面结构复杂或非标准
- 访问限制（登录要求、robots.txt等）

**解决方案**：
- 尝试使用 `summary_length: "detailed"` 获取更多内容
- 检查目标页面是否需要特殊处理
- 考虑使用备用URL或简化页面结构

#### 3. 内存使用过高
**症状**：处理大量页面时性能下降或失败
**可能原因**：
- 同时处理过多大型页面
- 页面包含大量媒体内容

**解决方案**：
- 减少单次处理的URL数量（建议不超过20个）
- 使用 `summary_length: "short"` 减少内容提取量
- 分批处理，中间添加延迟

#### 4. 输出格式问题
**症状**：生成的Markdown格式不正确或包含乱码
**可能原因**：
- 网页编码问题
- 特殊字符处理不当
- 语言设置不匹配

**解决方案**：
- 确保 `language` 参数与页面内容语言一致
- 尝试使用 `output_format: "text"` 简化输出
- 检查并清理输入URL中的特殊字符

### 性能优化建议

1. **分批处理**：对于大量URL，建议每批处理10-20个
2. **使用适当长度**：根据需求选择合适的总结长度
3. **缓存结果**：对于重复处理的URL，考虑实现本地缓存
4. **错误重试**：对于临时失败，可以实现简单的重试机制

### 调试信息

工具在遇到错误时会向标准错误输出（stderr）打印详细信息，包括：
- 失败的URL和具体错误信息
- 网络请求状态码
- 内容提取过程中的警告

可以通过检查这些信息来诊断问题原因。

</chunk>

## 最佳实践

### 输入准备
1. **URL验证**：确保所有URL格式正确且可访问
2. **内容筛选**：只包含需要总结的相关页面
3. **分类处理**：将相似主题的页面放在一起处理

### 参数选择
1. **总结长度**：
   - `short`：适用于快速浏览和要点提取
   - `medium`：平衡详细程度和可读性（推荐）
   - `detailed`：适用于需要完整上下文的情况

2. **输出格式**：
   - `markdown`：适用于文档化和进一步编辑
   - `text`：适用于纯文本处理或简单查看

### 结果处理
1. **质量检查**：始终检查 `processed_count` 和 `failed_urls`
2. **后处理**：根据需要对生成的总结进行格式调整
3. **存储建议**：将结果保存为文件以便后续使用

## 限制说明

1. **页面数量**：建议单次处理不超过50个页面
2. **内容类型**：主要针对文本内容，对视频、音频等媒体内容支持有限
3. **语言支持**：对中文和英文支持最佳，其他语言可能效果有限
4. **动态内容**：对JavaScript动态加载的内容提取能力有限

## 更新日志

- **v1.0.0**：初始版本发布，支持基本的多页面总结功能
- 支持多种输出格式和总结长度
- 包含完整的错误处理和状态报告
- 提供详细的文档和示例

---

*注意：本工具依赖于外部网络服务，处理时间可能因网络状况和目标网站响应速度而异。建议在生产环境中添加适当的超时和重试机制。*