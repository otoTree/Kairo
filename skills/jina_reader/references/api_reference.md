---
name: jina_reader
description: A web content extraction and reading skill that processes URLs to extract clean, readable text content
version: 1.0.0
---

# Jina Reader

## Overview

Jina Reader is a specialized skill designed to extract and process readable content from web pages. It takes URLs as input and returns structured, clean text content by removing ads, navigation elements, and other non-essential page components. The skill is particularly useful for content aggregation, research, and creating readable versions of web articles.

## Interface

### Input Schema
The skill accepts the following parameters:

- `url` (string, required): The complete URL of the web page to process
- `timeout` (integer, optional, default=30): Request timeout in seconds
- `include_metadata` (boolean, optional, default=False): Whether to include page metadata in the response

### Output Schema
The skill returns a dictionary with the following structure:

```python
{
    "success": bool,           # Whether the operation was successful
    "content": str,            # Extracted text content (empty if failed)
    "title": str,              # Page title (if available)
    "url": str,                # Original URL processed
    "error": str,              # Error message (only if success=False)
    "metadata": dict           # Additional metadata (if include_metadata=True)
}
```

<chunk id="examples" description="Detailed usage examples">
## Examples

### Basic Usage
Extract content from a single URL:

```python
result = main(
    url="https://example.com/article",
    timeout=30,
    include_metadata=False
)

# Successful result:
{
    "success": True,
    "content": "Full article text here...",
    "title": "Example Article Title",
    "url": "https://example.com/article",
    "error": "",
    "metadata": {}
}
```

### With Metadata
Extract content including page metadata:

```python
result = main(
    url="https://news.example.com/story",
    timeout=45,
    include_metadata=True
)

# Result includes metadata:
{
    "success": True,
    "content": "News article content...",
    "title": "Breaking News Story",
    "url": "https://news.example.com/story",
    "error": "",
    "metadata": {
        "author": "John Doe",
        "published_date": "2024-01-15",
        "word_count": 1250,
        "language": "en"
    }
}
```

### Error Handling
When processing fails:

```python
result = main(
    url="https://invalid-url.example",
    timeout=10,
    include_metadata=False
)

# Error result:
{
    "success": False,
    "content": "",
    "title": "",
    "url": "https://invalid-url.example",
    "error": "Failed to fetch URL: Connection timeout",
    "metadata": {}
}
```

### Batch Processing Example
Process multiple URLs in sequence:

```python
urls = [
    "https://blog.example.com/post1",
    "https://blog.example.com/post2",
    "https://blog.example.com/post3"
]

results = []
for url in urls:
    result = main(url=url, timeout=30, include_metadata=True)
    results.append(result)
```
</chunk>

<chunk id="troubleshooting" description="Common errors and fixes">
## Troubleshooting

### Common Errors and Solutions

#### 1. Connection Timeout
**Error**: `"Failed to fetch URL: Connection timeout"`
**Causes**:
- Network connectivity issues
- Server not responding
- Firewall blocking the request
**Solutions**:
- Increase the `timeout` parameter value
- Check network connection
- Verify the URL is accessible from your network

#### 2. Invalid URL Format
**Error**: `"Invalid URL format"`
**Causes**:
- Missing protocol (http:// or https://)
- Malformed URL string
- Invalid characters in URL
**Solutions**:
- Ensure URL starts with `http://` or `https://`
- Validate URL format before passing to the skill
- URL-encode special characters if needed

#### 3. Content Extraction Failure
**Error**: `"Failed to extract content from page"`
**Causes**:
- Page uses heavy JavaScript rendering
- Unsupported page structure
- Blocked by anti-scraping measures
**Solutions**:
- Try alternative URLs for the same content
- Check if the page requires JavaScript execution
- Consider using the website's official API if available

#### 4. SSL Certificate Errors
**Error**: `"SSL certificate verification failed"`
**Causes**:
- Self-signed certificates
- Expired certificates
- Certificate chain issues
**Solutions**:
- Verify the website's SSL certificate is valid
- For development/testing, the environment may need certificate configuration

#### 5. Rate Limiting
**Error**: `"Too many requests"` or `"Rate limit exceeded"`
**Causes**:
- Making too many requests in a short time
- Website has request limits
**Solutions**:
- Add delays between requests
- Implement exponential backoff
- Check website's terms of service for rate limits

### Performance Tips

1. **Optimal Timeout Values**:
   - News/articles: 30-60 seconds
   - Simple pages: 10-20 seconds
   - International sites: 60+ seconds

2. **Memory Management**:
   - The skill processes one URL at a time
   - Large pages may use significant memory
   - Monitor memory usage for batch processing

3. **Network Considerations**:
   - Consider proxy servers for high-volume usage
   - Implement caching for frequently accessed URLs
   - Use appropriate User-Agent headers if needed

### Debugging Steps

If you encounter persistent issues:

1. **Verify URL Accessibility**:
   ```bash
   curl -I https://example.com
   ```

2. **Check Skill Configuration**:
   - Ensure all required parameters are provided
   - Verify parameter types match expected values

3. **Test with Different URLs**:
   - Try known working URLs to isolate the issue
   - Test with simple HTML pages first

4. **Review Error Messages**:
   - The `error` field contains specific failure details
   - Check stderr output for additional debugging information
</chunk>