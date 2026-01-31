---
name: jina_multi_page_summarizer
description: Summarizes content from multiple web pages using Jina AI's summarization capabilities and consolidates results into a structured document.
version: 1.0.0
---

# Jina Multi-Page Summarizer

## Overview

The Jina Multi-Page Summarizer skill processes multiple web page URLs, extracts their textual content, generates concise summaries for each page using Jina AI's services, and combines all summaries into a single, well-structured document. This is ideal for research, content curation, and quick information digestion from multiple online sources.

## Interface

### Input Schema
The `main` function accepts the following parameters:
- `urls` (List[str]): A list of web page URLs to process. Required.
- `summary_length` (str, optional): Desired summary length. Options: 'short', 'medium', 'long'. Defaults to 'medium'.
- `output_format` (str, optional): Format for the consolidated document. Options: 'markdown', 'plaintext'. Defaults to 'markdown'.
- `include_source` (bool, optional): Whether to include the source URL with each summary. Defaults to True.

### Output Schema
The function returns a dictionary with this structure:
```python
{
    "success": bool,           # Overall operation success status
    "document": str,           # The consolidated summary document
    "page_results": list,      # List of dicts with details for each processed page
    "error_message": str       # Empty string if success=True, otherwise error details
}
```

<chunk id="examples" description="Detailed usage examples">
## Examples

### Example 1: Basic Usage
```python
# Process three news articles
result = main(
    urls=[
        "https://example.com/article1",
        "https://example.com/article2", 
        "https://example.com/article3"
    ],
    summary_length="medium",
    output_format="markdown"
)

if result["success"]:
    print("Consolidated Document:")
    print(result["document"])
    print(f"\nProcessed {len(result['page_results'])} pages successfully.")
else:
    print(f"Error: {result['error_message']}")
```

### Example 2: Research Paper Abstracts
```python
# Summarize academic papers with source attribution
result = main(
    urls=[
        "https://arxiv.org/abs/2301.12345",
        "https://arxiv.org/abs/2302.23456",
        "https://arxiv.org/abs/2303.34567"
    ],
    summary_length="long",
    output_format="markdown",
    include_source=True
)

# Save to file
if result["success"]:
    with open("research_summary.md", "w") as f:
        f.write(result["document"])
```

### Example 3: Quick News Digest
```python
# Get brief summaries for daily news reading
result = main(
    urls=[
        "https://news.site.com/politics",
        "https://news.site.com/technology",
        "https://news.site.com/business"
    ],
    summary_length="short",
    output_format="plaintext",
    include_source=False
)

if result["success"]:
    # Display in terminal
    print(result["document"])
```
</chunk>

<chunk id="troubleshooting" description="Common errors and fixes">
## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Network Connection Errors
**Symptoms**: `page_results` show failures for specific URLs, `error_message` contains network-related terms.
**Solutions**:
- Verify internet connectivity
- Check if URLs are accessible from your network
- Ensure URLs use correct protocol (http:// or https://)
- Some sites may block automated access; try fewer URLs or add delays

#### Issue 2: Content Extraction Failures
**Symptoms**: Summaries are empty or contain only metadata, success rate varies by website.
**Solutions**:
- The skill uses best-effort content extraction; some sites with complex JavaScript may not work
- Try alternative URLs for the same content
- Check if the site requires authentication or has paywalls

#### Issue 3: Jina API Limitations
**Symptoms**: Timeouts or incomplete summaries for very long pages.
**Solutions**:
- Use `summary_length="short"` for very content-rich pages
- Break extremely long articles into multiple URLs if possible
- Ensure text content is primarily in supported languages

#### Issue 4: Invalid URL Format
**Symptoms**: Immediate failure with specific error about URL format.
**Solutions**:
- Ensure URLs include protocol (http:// or https://)
- Remove any trailing spaces or special characters
- Verify URL is properly encoded if it contains special characters

#### Issue 5: Rate Limiting
**Symptoms**: Intermittent failures, especially with many URLs.
**Solutions**:
- Process fewer URLs per call (recommended: 5-10 URLs maximum)
- Add delays between processing batches if calling repeatedly
- Consider the complexity of each page's content

### Debugging Tips
1. Check `page_results` for individual page status
2. Start with a single, simple URL to verify functionality
3. Test with publicly accessible, text-heavy pages first
4. Monitor console output for detailed error messages
5. Verify Python environment has network access permissions
</chunk>

## Implementation Notes

- The skill processes URLs sequentially for reliability
- Each page's content is cleaned and normalized before summarization
- The consolidated document includes timestamps and processing metadata
- All network calls include timeout protection and error handling
- The output maintains consistent formatting regardless of input variations

## Performance Considerations

- Processing time scales linearly with number of URLs
- Average processing time: 2-5 seconds per page depending on content length
- Network latency can significantly impact total processing time
- Memory usage remains stable regardless of input size

## Best Practices

1. **URL Selection**: Choose text-heavy pages over image/video-centric content
2. **Batch Size**: Process 5-10 URLs at a time for optimal performance
3. **Summary Length**: Use 'short' for news, 'medium' for articles, 'long' for reports
4. **Output Format**: 'markdown' provides better structure for most use cases
5. **Error Handling**: Always check the `success` flag and `error_message` in results