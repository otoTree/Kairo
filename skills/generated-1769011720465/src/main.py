import sys
import json
import asyncio
import aiohttp
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse
from pathlib import Path
import hashlib
import time


def main(
    urls: List[str],
    summary_length: int = 200,
    output_format: str = "markdown",
    include_metadata: bool = True,
    concurrent_requests: int = 3
) -> Dict[str, Any]:
    """
    Main entry point for the Jina multi-page summarizer skill.
    
    Args:
        urls: List of URLs to summarize
        summary_length: Target length for each summary in characters
        output_format: Output format - "markdown" or "json"
        include_metadata: Whether to include metadata in the output
        concurrent_requests: Maximum number of concurrent requests
        
    Returns:
        Dictionary containing the summarized document and metadata
    """
    
    # Initialize result structure
    result: Dict[str, Any] = {
        "status": "success",
        "document": "",
        "summaries": [],
        "metadata": {
            "total_urls": len(urls),
            "successful_summaries": 0,
            "failed_urls": [],
            "processing_time": 0
        }
    }
    
    start_time = time.time()
    
    try:
        # Validate input parameters
        if not urls:
            result["status"] = "error"
            result["error"] = "No URLs provided"
            return result
            
        if summary_length < 50 or summary_length > 1000:
            result["status"] = "error"
            result["error"] = "summary_length must be between 50 and 1000"
            return result
            
        if output_format not in ["markdown", "json"]:
            result["status"] = "error"
            result["error"] = "output_format must be 'markdown' or 'json'"
            return result
            
        if concurrent_requests < 1 or concurrent_requests > 10:
            result["status"] = "error"
            result["error"] = "concurrent_requests must be between 1 and 10"
            return result
        
        # Run the async summarization
        summaries = asyncio.run(
            fetch_and_summarize_urls(
                urls=urls,
                summary_length=summary_length,
                concurrent_requests=concurrent_requests
            )
        )
        
        # Process results
        successful_summaries = []
        failed_urls = []
        
        for url, summary_data in zip(urls, summaries):
            if summary_data["status"] == "success":
                successful_summaries.append(summary_data)
            else:
                failed_urls.append({
                    "url": url,
                    "error": summary_data.get("error", "Unknown error")
                })
        
        # Generate final document
        if successful_summaries:
            if output_format == "markdown":
                result["document"] = generate_markdown_document(
                    summaries=successful_summaries,
                    include_metadata=include_metadata
                )
            else:  # json format
                result["document"] = generate_json_document(
                    summaries=successful_summaries,
                    include_metadata=include_metadata
                )
        
        # Update metadata
        result["summaries"] = successful_summaries
        result["metadata"]["successful_summaries"] = len(successful_summaries)
        result["metadata"]["failed_urls"] = failed_urls
        result["metadata"]["processing_time"] = time.time() - start_time
        
        # If all URLs failed, set status to error
        if not successful_summaries:
            result["status"] = "error"
            result["error"] = "All URLs failed to process"
        
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        print(f"Error in main function: {e}", file=sys.stderr)
    
    return result


async def fetch_and_summarize_urls(
    urls: List[str],
    summary_length: int,
    concurrent_requests: int
) -> List[Dict[str, Any]]:
    """
    Fetch and summarize multiple URLs concurrently.
    
    Args:
        urls: List of URLs to process
        summary_length: Target summary length
        concurrent_requests: Maximum concurrent requests
        
    Returns:
        List of summary dictionaries
    """
    semaphore = asyncio.Semaphore(concurrent_requests)
    
    async def process_url(url: str) -> Dict[str, Any]:
        async with semaphore:
            return await fetch_and_summarize_single_url(url, summary_length)
    
    tasks = [process_url(url) for url in urls]
    return await asyncio.gather(*tasks)


async def fetch_and_summarize_single_url(
    url: str,
    summary_length: int
) -> Dict[str, Any]:
    """
    Fetch and summarize a single URL.
    
    Args:
        url: URL to process
        summary_length: Target summary length
        
    Returns:
        Dictionary containing the summary and metadata
    """
    result: Dict[str, Any] = {
        "status": "success",
        "url": url,
        "summary": "",
        "title": "",
        "word_count": 0,
        "timestamp": time.time()
    }
    
    try:
        # Validate URL
        parsed_url = urlparse(url)
        if not parsed_url.scheme or not parsed_url.netloc:
            result["status"] = "error"
            result["error"] = "Invalid URL format"
            return result
        
        # Fetch content
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(url, timeout=30) as response:
                    if response.status != 200:
                        result["status"] = "error"
                        result["error"] = f"HTTP {response.status}"
                        return result
                    
                    content = await response.text()
                    
                    # Extract title
                    title_start = content.find("<title>")
                    title_end = content.find("</title>")
                    if title_start != -1 and title_end != -1:
                        result["title"] = content[title_start+7:title_end].strip()
                    
                    # Extract main content (simplified - in production would use better parsing)
                    text_content = extract_text_from_html(content)
                    
                    if not text_content:
                        result["status"] = "error"
                        result["error"] = "No text content found"
                        return result
                    
                    # Generate summary
                    result["summary"] = generate_summary(text_content, summary_length)
                    result["word_count"] = len(text_content.split())
                    
            except asyncio.TimeoutError:
                result["status"] = "error"
                result["error"] = "Request timeout"
            except Exception as e:
                result["status"] = "error"
                result["error"] = str(e)
                
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
        print(f"Error processing URL {url}: {e}", file=sys.stderr)
    
    return result


def extract_text_from_html(html_content: str) -> str:
    """
    Extract text content from HTML (simplified version).
    
    Args:
        html_content: Raw HTML content
        
    Returns:
        Extracted text content
    """
    # Remove script and style tags
    import re
    
    # Remove script tags
    html_content = re.sub(r'<script.*?>.*?</script>', '', html_content, flags=re.DOTALL)
    # Remove style tags
    html_content = re.sub(r'<style.*?>.*?</style>', '', html_content, flags=re.DOTALL)
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', html_content)
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    # Decode HTML entities (simplified)
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    
    return text


def generate_summary(text: str, target_length: int) -> str:
    """
    Generate a summary of the text with target length.
    
    Args:
        text: Input text to summarize
        target_length: Target summary length in characters
        
    Returns:
        Generated summary
    """
    if len(text) <= target_length:
        return text
    
    # Simple summarization by taking the first part of the text
    # In production, this would use more sophisticated NLP techniques
    sentences = text.split('. ')
    
    summary = ""
    for sentence in sentences:
        if len(summary) + len(sentence) + 1 <= target_length:
            if summary:
                summary += ". "
            summary += sentence
        else:
            break
    
    # If we couldn't get any complete sentences, just truncate
    if not summary:
        summary = text[:target_length].rsplit(' ', 1)[0] + "..."
    elif not summary.endswith('.'):
        summary += "..."
    
    return summary


def generate_markdown_document(
    summaries: List[Dict[str, Any]],
    include_metadata: bool
) -> str:
    """
    Generate a markdown document from summaries.
    
    Args:
        summaries: List of summary dictionaries
        include_metadata: Whether to include metadata
        
    Returns:
        Markdown document
    """
    document = "# Multi-Page Summary Document\n\n"
    
    if include_metadata:
        document += f"## Metadata\n"
        document += f"- Total pages summarized: {len(summaries)}\n"
        document += f"- Generated on: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    
    document += "## Page Summaries\n\n"
    
    for i, summary in enumerate(summaries, 1):
        document += f"### {i}. {summary.get('title', 'Untitled')}\n"
        document += f"**URL:** {summary['url']}\n\n"
        
        if include_metadata:
            document += f"- **Word count:** {summary.get('word_count', 0)}\n"
            document += f"- **Processed:** {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(summary.get('timestamp', 0)))}\n\n"
        
        document += f"**Summary:**\n\n{summary['summary']}\n\n"
        document += "---\n\n"
    
    return document


def generate_json_document(
    summaries: List[Dict[str, Any]],
    include_metadata: bool
) -> str:
    """
    Generate a JSON document from summaries.
    
    Args:
        summaries: List of summary dictionaries
        include_metadata: Whether to include metadata
        
    Returns:
        JSON document as string
    """
    document_data = {
        "title": "Multi-Page Summary Document",
        "generated_at": time.strftime('%Y-%m-%d %H:%M:%S'),
        "total_pages": len(summaries),
        "pages": []
    }
    
    for summary in summaries:
        page_data = {
            "url": summary["url"],
            "title": summary.get("title", "Untitled"),
            "summary": summary["summary"]
        }
        
        if include_metadata:
            page_data.update({
                "word_count": summary.get("word_count", 0),
                "processed_at": time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(summary.get("timestamp", 0)))
            })
        
        document_data["pages"].append(page_data)
    
    return json.dumps(document_data, indent=2, ensure_ascii=False)