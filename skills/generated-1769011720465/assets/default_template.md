---
name: jina_multi_page_summarizer
description: 使用Jina AI的多页面总结器，从多个网页URL提取并汇总内容，生成结构化文档摘要
version: 1.0.0
---

# Jina多页面总结汇总器

## 概述

`jina_multi_page_summarizer` 技能能够从多个网页URL中提取文本内容，使用Jina AI的总结能力生成每个页面的摘要，并将所有摘要汇总成一个结构化的文档。该技能适用于研究、内容分析、市场调研等需要处理多个网页信息的场景。

## 接口

### 输入参数

| 参数名 | 类型 | 必填 | 描述 | 示例 |
|--------|------|------|------|------|
| `urls` | `List[str]` | 是 | 需要总结的网页URL列表 | `["https://example.com/page1", "https://example.com/page2"]` |
| `summary_length` | `str` | 否 | 摘要长度选项，默认为"medium" | `"short"`, `"medium"`, `"long"` |
| `language` | `str` | 否 | 输出摘要的语言，默认为"中文" | `"中文"`, `"English"`, `"日本語"` |
| `include_metadata` | `bool` | 否 | 是否在输出中包含元数据，默认为True | `true`, `false` |

### 输出结构

技能返回一个字典，包含以下字段：

```python
{
    "status": "success" | "partial_success" | "error",
    "total_urls": int,
    "processed_urls": int,
    "failed_urls": int,
    "summary_document": str,
    "individual_summaries": List[Dict],
    "error_messages": List[str] | None
}
```

其中 `individual_summaries` 的每个元素结构为：
```python
{
    "url": str,
    "title": str,
    "summary": str,
    "word_count": int,
    "processing_time": float,
    "status": "success" | "failed"
}
```

<chunk id="examples" description="详细使用示例">

## 示例

### 示例1：基本使用

```python
# 输入参数
params = {
    "urls": [
        "https://news.example.com/article1",
        "https://blog.example.com/post2",
        "https://docs.example.com/guide3"
    ],
    "summary_length": "medium",
    "language": "中文",
    "include_metadata": True
}

# 调用技能
result = main(**params)

# 输出示例
print(f"处理状态: {result['status']}")
print(f"处理URL总数: {result['total_urls']}")
print(f"成功处理: {result['processed_urls']}")
print(f"失败URL数: {result['failed_urls']}")
print(f"\n汇总文档:\n{result['summary_document']}")

# 查看单个摘要
for summary in result['individual_summaries']:
    if summary['status'] == 'success':
        print(f"\nURL: {summary['url']}")
        print(f"标题: {summary['title']}")
        print(f"摘要: {summary['summary'][:100]}...")
```

### 示例2：处理大量URL

```python
# 批量处理多个URL
urls = [
    "https://research.example.com/paper1",
    "https://research.example.com/paper2",
    "https://research.example.com/paper3",
    "https://research.example.com/paper4",
    "https://research.example.com/paper5"
]

result = main(
    urls=urls,
    summary_length="short",  # 使用短摘要以加快处理速度
    language="English",
    include_metadata=False
)

# 检查处理结果
if result['status'] == 'success':
    print("所有URL处理成功！")
elif result['status'] == 'partial_success':
    print(f"部分URL处理成功。失败数: {result['failed_urls']}")
    if result['error_messages']:
        for error in result['error_messages']:
            print(f"错误: {error}")
```

### 示例3：自定义输出

```python
# 生成详细的长摘要
result = main(
    urls=["https://docs.example.com/tutorial"],
    summary_length="long",
    language="中文",
    include_metadata=True
)

# 提取结构化信息
if result['individual_summaries']:
    summary = result['individual_summaries'][0]
    print(f"文档标题: {summary['title']}")
    print(f"摘要字数: {summary['word_count']}")
    print(f"处理时间: {summary['processing_time']:.2f}秒")
    print(f"完整摘要:\n{summary['summary']}")
```

</chunk>

<chunk id="troubleshooting" description="常见错误和解决方案">

## 故障排除

### 常见错误及解决方案

#### 错误1：网络连接失败
**症状**：
- `status` 为 `"partial_success"` 或 `"error"`
- `error_messages` 包含网络相关错误

**可能原因**：
1. URL无法访问或不存在
2. 网络连接问题
3. 网站阻止爬虫访问

**解决方案**：
1. 验证URL是否正确且可访问
2. 检查网络连接
3. 尝试减少同时处理的URL数量
4. 对于需要登录的网站，本技能无法访问

#### 错误2：内容提取失败
**症状**：
- 个别URL的 `status` 为 `"failed"`
- 摘要内容为空或不完整

**可能原因**：
1. 网页使用JavaScript动态加载内容
2. 网页结构复杂，难以提取文本
3. 内容被加密或需要特殊解析

**解决方案**：
1. 尝试使用网页的打印版本或移动版URL
2. 检查网页是否使用了反爬虫技术
3. 考虑使用备用URL或API接口

#### 错误3：处理超时
**症状**：
- 处理时间过长
- 部分URL未能完成处理

**可能原因**：
1. 网页内容过多
2. 网络延迟
3. 服务器响应慢

**解决方案**：
1. 设置 `summary_length` 为 `"short"` 以减少处理时间
2. 分批处理大量URL
3. 移除响应慢的URL

#### 错误4：语言识别问题
**症状**：
- 摘要语言不符合预期
- 混合语言内容处理不当

**可能原因**：
1. 网页包含多种语言
2. 语言检测不准确
3. 特定术语翻译问题

**解决方案**：
1. 明确指定 `language` 参数
2. 对于多语言网站，可能需要分别处理不同语言的部分
3. 检查源网页的主要语言

### 性能优化建议

1. **批量处理**：一次性处理相关主题的URL，提高效率
2. **摘要长度选择**：
   - `"short"`：快速浏览，适合大量URL
   - `"medium"`：平衡详细度和速度
   - `"long"`：详细分析，适合重要文档
3. **URL预处理**：确保URL格式正确，移除跟踪参数
4. **错误处理**：使用 `try-except` 包装技能调用，处理可能的异常

### 限制说明

1. **内容类型**：主要处理文本内容，图片、视频等多媒体内容无法提取
2. **访问限制**：无法访问需要登录、验证码或特殊权限的网站
3. **处理时间**：每个URL的处理时间取决于内容长度和网络状况
4. **语言支持**：支持主流语言，但某些小众语言可能识别不准确
5. **最大URL数**：建议单次处理不超过10个URL以保证稳定性

</chunk>

## 使用建议

### 最佳实践

1. **URL质量**：确保提供的URL直接指向文章内容页，而非首页或目录页
2. **内容相关性**：批量处理主题相关的URL，以获得更好的汇总效果
3. **参数调整**：根据需求调整 `summary_length`，平衡详细度和处理时间
4. **结果验证**：定期检查 `individual_summaries` 中的状态和错误信息

### 应用场景

1. **学术研究**：汇总多篇相关论文的摘要
2. **市场分析**：收集竞争对手网站信息并生成报告
3. **内容策划**：分析多个来源的内容趋势
4. **知识管理**：创建多个文档的知识摘要库

### 注意事项

- 尊重版权和网站的使用条款
- 避免过度频繁地请求同一网站
- 处理敏感信息时注意数据安全
- 结果仅供参考，重要决策应查阅原始资料

---

*技能版本：1.0.0 | 最后更新：2024年*  
*使用Jina AI技术提供摘要生成能力*