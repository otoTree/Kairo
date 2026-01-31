import json
import sys
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse
import requests
from datetime import datetime


def main(
    urls: List[str],
    max_depth: int = 2,
    include_metadata: bool = True,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Collect web content from specified URLs using Jina AI's web scraping capabilities.
    
    Args:
        urls: List of URLs to collect content from
        max_depth: Maximum depth for following links (default: 2)
        include_metadata: Whether to include metadata in the response (default: True)
        timeout: Request timeout in seconds (default: 30)
    
    Returns:
        Dictionary containing collected web content and metadata
    """
    result: Dict[str, Any] = {
        "collected_data": [],
        "metadata": {
            "total_urls": len(urls),
            "successful_collections": 0,
            "failed_collections": 0,
            "collection_time": None
        },
        "errors": []
    }
    
    start_time = datetime.now()
    
    try:
        if not urls:
            result["errors"].append("No URLs provided for collection")
            result["metadata"]["collection_time"] = datetime.now().isoformat()
            return result
        
        for url in urls:
            try:
                # Validate URL format
                parsed_url = urlparse(url)
                if not all([parsed_url.scheme, parsed_url.netloc]):
                    result["errors"].append(f"Invalid URL format: {url}")
                    result["metadata"]["failed_collections"] += 1
                    continue
                
                # Collect content from URL
                page_data = collect_web_content(
                    url=url,
                    max_depth=max_depth,
                    include_metadata=include_metadata,
                    timeout=timeout
                )
                
                if page_data:
                    result["collected_data"].append(page_data)
                    result["metadata"]["successful_collections"] += 1
                else:
                    result["metadata"]["failed_collections"] += 1
                    
            except Exception as e:
                error_msg = f"Error processing URL {url}: {str(e)}"
                print(f"Error: {error_msg}", file=sys.stderr)
                result["errors"].append(error_msg)
                result["metadata"]["failed_collections"] += 1
        
        result["metadata"]["collection_time"] = datetime.now().isoformat()
        
    except Exception as e:
        error_msg = f"Unexpected error in main function: {str(e)}"
        print(f"Critical Error: {error_msg}", file=sys.stderr)
        result["errors"].append(error_msg)
        result["metadata"]["collection_time"] = datetime.now().isoformat()
    
    return result


def collect_web_content(
    url: str,
    max_depth: int,
    include_metadata: bool,
    timeout: int
) -> Optional[Dict[str, Any]]:
    """
    Collect web content from a single URL.
    
    Args:
        url: URL to collect content from
        max_depth: Maximum depth for following links
        include_metadata: Whether to include metadata
        timeout: Request timeout in seconds
    
    Returns:
        Dictionary containing collected content and metadata for the URL
    """
    try:
        # Make HTTP request to the URL
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(
            url,
            headers=headers,
            timeout=timeout,
            allow_redirects=True
        )
        response.raise_for_status()
        
        # Parse the response
        content_type = response.headers.get('content-type', '').lower()
        
        page_data: Dict[str, Any] = {
            "url": url,
            "status_code": response.status_code,
            "content_type": content_type,
            "content_length": len(response.content),
            "collected_at": datetime.now().isoformat()
        }
        
        # Extract content based on content type
        if 'text/html' in content_type:
            page_data["content"] = extract_html_content(response.text)
            page_data["links"] = extract_links(response.text, url, max_depth)
        elif 'application/json' in content_type:
            page_data["content"] = response.json()
        elif 'text/plain' in content_type or 'text/' in content_type:
            page_data["content"] = response.text
        else:
            page_data["content"] = f"Binary content of type: {content_type}"
        
        # Add metadata if requested
        if include_metadata:
            page_data["metadata"] = {
                "response_headers": dict(response.headers),
                "encoding": response.encoding,
                "elapsed_time": response.elapsed.total_seconds(),
                "final_url": response.url
            }
        
        return page_data
        
    except requests.exceptions.RequestException as e:
        print(f"Request error for {url}: {str(e)}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Error collecting content from {url}: {str(e)}", file=sys.stderr)
        return None


def extract_html_content(html_content: str) -> Dict[str, Any]:
    """
    Extract structured content from HTML.
    
    Args:
        html_content: Raw HTML content
    
    Returns:
        Dictionary with extracted content
    """
    try:
        # Simple HTML parsing without external libraries
        content = {
            "title": extract_title(html_content),
            "text_content": extract_text(html_content),
            "headings": extract_headings(html_content),
            "images": extract_image_count(html_content)
        }
        return content
    except Exception as e:
        print(f"Error extracting HTML content: {str(e)}", file=sys.stderr)
        return {"error": "Failed to parse HTML content"}


def extract_title(html_content: str) -> str:
    """Extract page title from HTML."""
    try:
        title_start = html_content.find('<title>')
        title_end = html_content.find('</title>')
        if title_start != -1 and title_end != -1:
            return html_content[title_start + 7:title_end].strip()
        return ""
    except:
        return ""


def extract_text(html_content: str) -> str:
    """Extract plain text from HTML (simplified)."""
    try:
        # Remove script and style tags
        import re
        cleaned = re.sub(r'<script.*?</script>', '', html_content, flags=re.DOTALL)
        cleaned = re.sub(r'<style.*?</style>', '', cleaned, flags=re.DOTALL)
        cleaned = re.sub(r'<[^>]+>', ' ', cleaned)
        cleaned = re.sub(r'\s+', ' ', cleaned)
        return cleaned.strip()[:5000]  # Limit text length
    except:
        return ""


def extract_headings(html_content: str) -> Dict[str, List[str]]:
    """Extract headings from HTML."""
    headings = {"h1": [], "h2": [], "h3": []}
    try:
        import re
        for tag in ["h1", "h2", "h3"]:
            pattern = f'<{tag}[^>]*>(.*?)</{tag}>'
            matches = re.findall(pattern, html_content, re.IGNORECASE | re.DOTALL)
            for match in matches:
                # Clean HTML tags from heading text
                clean_text = re.sub(r'<[^>]+>', '', match).strip()
                if clean_text:
                    headings[tag].append(clean_text)
    except:
        pass
    return headings


def extract_image_count(html_content: str) -> int:
    """Count images in HTML."""
    try:
        import re
        img_tags = re.findall(r'<img[^>]*>', html_content, re.IGNORECASE)
        return len(img_tags)
    except:
        return 0


def extract_links(html_content: str, base_url: str, max_depth: int) -> List[Dict[str, str]]:
    """
    Extract links from HTML content.
    
    Args:
        html_content: Raw HTML content
        base_url: Base URL for resolving relative links
        max_depth: Maximum depth for link following
    
    Returns:
        List of extracted links with metadata
    """
    links = []
    try:
        import re
        from urllib.parse import urljoin
        
        # Find all anchor tags
        pattern = r'<a[^>]*href=["\']([^"\']*)["\'][^>]*>(.*?)</a>'
        matches = re.findall(pattern, html_content, re.IGNORECASE | re.DOTALL)
        
        for href, text in matches:
            if href and not href.startswith(('#', 'javascript:', 'mailto:')):
                # Resolve relative URLs
                full_url = urljoin(base_url, href)
                
                # Clean link text
                clean_text = re.sub(r'<[^>]+>', '', text).strip()
                
                links.append({
                    "url": full_url,
                    "text": clean_text[:200],  # Limit text length
                    "depth": 1  # Current depth level
                })
                
                # Limit number of links to avoid excessive processing
                if len(links) >= 50:
                    break
                    
    except Exception as e:
        print(f"Error extracting links: {str(e)}", file=sys.stderr)
    
    return links