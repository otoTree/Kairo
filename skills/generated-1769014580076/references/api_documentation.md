---
name: jina_web_collector
description: A web content collection skill that extracts and processes information from web pages using Jina AI's technology.
version: 1.0.0
---

# Jina Web Collector

## Overview

The Jina Web Collector skill enables automated extraction and processing of web content from specified URLs. It leverages Jina AI's technology to intelligently collect, parse, and structure web page information for downstream analysis and processing tasks.

This skill is designed to handle various web content types while maintaining data integrity and providing structured output suitable for further processing in data pipelines.

## Interface

### Input Schema

The skill accepts the following parameters:

- `urls` (List[str]): **Required**. A list of URLs to collect content from
- `timeout` (int, optional): Request timeout in seconds (default: 30)
- `max_content_length` (int, optional): Maximum content length to process in bytes (default: 10485760)
- `extract_metadata` (bool, optional): Whether to extract metadata from pages (default: True)
- `follow_redirects` (bool, optional): Whether to follow HTTP redirects (default: True)

### Output Schema

The skill returns a dictionary with the following structure:

```python
{
    "status": str,  # "success" or "error"
    "results": List[Dict[str, Any]],  # List of collected content objects
    "summary": Dict[str, int],  # Collection statistics
    "error_message": Optional[str]  # Error description if status is "error"
}
```

Each result object in the `results` list contains:
- `url`: Original URL
- `content`: Extracted main content
- `title`: Page title
- `metadata`: Page metadata (if extracted)
- `status_code`: HTTP status code
- `collection_time`: ISO format timestamp
- `error`: Error message if collection failed for this URL

<chunk id="examples" description="Detailed usage examples">
## Examples

### Basic Usage

Collect content from a single website:

```python
from src.main import main

result = main(
    urls=["https://example.com"],
    timeout=30,
    max_content_length=10485760,
    extract_metadata=True,
    follow_redirects=True
)

if result["status"] == "success":
    for item in result["results"]:
        print(f"Title: {item['title']}")
        print(f"Content length: {len(item['content'])} characters")
```

### Batch Collection

Process multiple URLs in one call:

```python
result = main(
    urls=[
        "https://news.example.com/article1",
        "https://news.example.com/article2",
        "https://blog.example.com/post"
    ],
    timeout=45,
    extract_metadata=True
)

print(f"Processed {result['summary']['processed']} URLs")
print(f"Successful: {result['summary']['successful']}")
print(f"Failed: {result['summary']['failed']}")
```

### Error Handling Example

```python
result = main(
    urls=["https://invalid-url.example", "https://valid.example.com"],
    timeout=10
)

if result["status"] == "error":
    print(f"Skill error: {result['error_message']}")
else:
    for item in result["results"]:
        if item.get("error"):
            print(f"Failed to collect {item['url']}: {item['error']}")
        else:
            print(f"Successfully collected {item['url']}")
```

### Content Limitation

Limit the amount of content collected:

```python
result = main(
    urls=["https://long-document.example.com"],
    max_content_length=5242880,  # 5MB limit
    extract_metadata=False
)
```
</chunk>

<chunk id="troubleshooting" description="Common errors and fixes">
## Troubleshooting

### Common Issues and Solutions

#### Connection Timeouts

**Problem**: Requests timing out frequently
**Solution**:
- Increase the `timeout` parameter value
- Check network connectivity
- Verify the target server is accessible

```python
# Increase timeout for slow servers
result = main(urls=["https://slow-server.example.com"], timeout=60)
```

#### Content Too Large

**Problem**: "Content exceeds maximum length" error
**Solution**:
- Increase `max_content_length` parameter
- Consider if you need all content or can work with truncated data

```python
# Allow larger content
result = main(
    urls=["https://large-document.example.com"],
    max_content_length=20971520  # 20MB
)
```

#### Invalid URLs

**Problem**: URLs failing to process
**Solution**:
- Verify URL format and accessibility
- Check if `follow_redirects=True` helps
- Consider pre-validating URLs before passing to the skill

```python
# Example with URL validation
import validators

urls_to_process = []
for url in candidate_urls:
    if validators.url(url):
        urls_to_process.append(url)

result = main(urls=urls_to_process)
```

#### SSL Certificate Issues

**Problem**: SSL verification failures
**Note**: The skill runs in a secure sandbox with controlled SSL settings
**Solution**:
- Verify the target site has valid SSL certificates
- Check if the site is accessible from the execution environment

#### Rate Limiting

**Problem**: Being blocked by target websites
**Solution**:
- Implement delays between requests in your calling code
- Respect robots.txt and terms of service
- Consider using fewer concurrent requests

```python
import time

urls = ["https://site.example.com/page1", "https://site.example.com/page2"]
results = []

for url in urls:
    result = main(urls=[url])
    results.append(result)
    time.sleep(2)  # 2-second delay between requests
```

### Performance Tips

1. **Batch Processing**: Process multiple URLs in single calls when possible
2. **Timeout Tuning**: Adjust timeout based on target server responsiveness
3. **Content Limits**: Set appropriate `max_content_length` for your use case
4. **Metadata**: Disable `extract_metadata` if not needed for better performance

### Error Response Examples

```python
# Network error example
{
    "status": "error",
    "results": [],
    "summary": {"processed": 0, "successful": 0, "failed": 0},
    "error_message": "Network connection failed"
}

# Partial success example
{
    "status": "success",
    "results": [
        {
            "url": "https://working.example.com",
            "content": "...",
            "title": "Working Page",
            "status_code": 200,
            "error": None
        },
        {
            "url": "https://broken.example.com",
            "content": "",
            "title": "",
            "status_code": 404,
            "error": "Page not found (404)"
        }
    ],
    "summary": {"processed": 2, "successful": 1, "failed": 1},
    "error_message": None
}
```
</chunk>