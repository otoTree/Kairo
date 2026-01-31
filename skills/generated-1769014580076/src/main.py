import sys
import json
import urllib.request
import urllib.error
import urllib.parse
from typing import List, Dict, Any, Optional
from pathlib import Path
import re
import html
from datetime import datetime


def fetch_url_content(url: str, timeout: int = 10) -> Optional[str]:
    """
    Fetch content from a URL with error handling.
    
    Args:
        url: The URL to fetch
        timeout: Request timeout in seconds
        
    Returns:
        The fetched content as string, or None if failed
    """
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            content = response.read().decode('utf-8', errors='ignore')
            return content
    except urllib.error.URLError as e:
        print(f"Error fetching URL {url}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Unexpected error fetching URL {url}: {e}", file=sys.stderr)
        return None


def extract_metadata_from_html(html_content: str, url: str) -> Dict[str, Any]:
    """
    Extract metadata from HTML content.
    
    Args:
        html_content: The HTML content
        url: Source URL
        
    Returns:
        Dictionary with extracted metadata
    """
    metadata = {
        'title': '',
        'description': '',
        'keywords': [],
        'author': '',
        'language': 'zh-CN',
        'url': url,
        'timestamp': datetime.now().isoformat()
    }
    
    try:
        # Extract title
        title_match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        if title_match:
            metadata['title'] = html.unescape(title_match.group(1).strip())
        
        # Extract meta tags
        meta_pattern = r'<meta\s+([^>]+)>'
        for meta_match in re.finditer(meta_pattern, html_content, re.IGNORECASE):
            meta_content = meta_match.group(1)
            
            # Check for name attribute
            name_match = re.search(r'name\s*=\s*["\']([^"\']+)["\']', meta_content, re.IGNORECASE)
            if not name_match:
                continue
            
            name = name_match.group(1).lower()
            content_match = re.search(r'content\s*=\s*["\']([^"\']+)["\']', meta_content, re.IGNORECASE)
            if not content_match:
                continue
            
            content = html.unescape(content_match.group(1).strip())
            
            if name == 'description':
                metadata['description'] = content
            elif name == 'keywords':
                metadata['keywords'] = [k.strip() for k in content.split(',') if k.strip()]
            elif name == 'author':
                metadata['author'] = content
        
        # Extract language
        lang_match = re.search(r'<html[^>]*lang\s*=\s*["\']([^"\']+)["\']', html_content, re.IGNORECASE)
        if lang_match:
            metadata['language'] = lang_match.group(1)
    
    except Exception as e:
        print(f"Error extracting metadata: {e}", file=sys.stderr)
    
    return metadata


def extract_main_content(html_content: str) -> str:
    """
    Extract main textual content from HTML.
    
    Args:
        html_content: The HTML content
        
    Returns:
        Extracted text content
    """
    try:
        # Remove script and style tags
        cleaned = re.sub(r'<script[^>]*>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r'<style[^>]*>.*?</style>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
        
        # Remove HTML tags but keep text
        text = re.sub(r'<[^>]+>', ' ', cleaned)
        
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)
        text = html.unescape(text.strip())
        
        # Limit length
        if len(text) > 5000:
            text = text[:5000] + '...'
        
        return text
    except Exception as e:
        print(f"Error extracting content: {e}", file=sys.stderr)
        return ""


def validate_url(url: str) -> bool:
    """
    Validate URL format.
    
    Args:
        url: URL to validate
        
    Returns:
        True if URL is valid
    """
    try:
        result = urllib.parse.urlparse(url)
        return all([result.scheme, result.netloc])
    except Exception:
        return False


def main(
    urls: List[str],
    include_metadata: bool = True,
    include_content: bool = True,
    timeout: int = 10
) -> Dict[str, Any]:
    """
    Main function for Jina web collector skill.
    
    Args:
        urls: List of URLs to collect
        include_metadata: Whether to include metadata in results
        include_content: Whether to include content in results
        timeout: Request timeout in seconds
        
    Returns:
        Dictionary with collection results
    """
    results = []
    errors = []
    
    # Validate URLs
    valid_urls = []
    for url in urls:
        if validate_url(url):
            valid_urls.append(url)
        else:
            errors.append(f"Invalid URL format: {url}")
    
    # Process each URL
    for url in valid_urls:
        try:
            # Fetch content
            html_content = fetch_url_content(url, timeout)
            if not html_content:
                errors.append(f"Failed to fetch content from: {url}")
                continue
            
            # Prepare result entry
            result_entry = {'url': url, 'success': True}
            
            # Extract metadata if requested
            if include_metadata:
                metadata = extract_metadata_from_html(html_content, url)
                result_entry['metadata'] = metadata
            
            # Extract content if requested
            if include_content:
                content = extract_main_content(html_content)
                result_entry['content'] = content
            
            results.append(result_entry)
            
        except Exception as e:
            error_msg = f"Error processing {url}: {str(e)}"
            print(error_msg, file=sys.stderr)
            errors.append(error_msg)
            results.append({
                'url': url,
                'success': False,
                'error': str(e)
            })
    
    # Prepare final result
    final_result = {
        'results': results,
        'summary': {
            'total_urls': len(urls),
            'successful': len([r for r in results if r.get('success', False)]),
            'failed': len([r for r in results if not r.get('success', True)]),
            'errors': errors if errors else []
        },
        'timestamp': datetime.now().isoformat()
    }
    
    return final_result