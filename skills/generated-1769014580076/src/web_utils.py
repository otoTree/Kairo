import json
import re
import sys
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse, urljoin
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import ssl
from html.parser import HTMLParser


class LinkExtractor(HTMLParser):
    """HTML parser to extract links from web pages."""
    
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.links: List[str] = []
        self.text_content: List[str] = []
        self.in_body = False
        
    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag == 'a':
            for attr, value in attrs:
                if attr == 'href' and value:
                    # Convert relative URLs to absolute
                    absolute_url = urljoin(self.base_url, value)
                    # Filter out non-HTTP URLs and fragments
                    if absolute_url.startswith(('http://', 'https://')):
                        self.links.append(absolute_url)
        elif tag == 'body':
            self.in_body = True
            
    def handle_endtag(self, tag: str) -> None:
        if tag == 'body':
            self.in_body = False
            
    def handle_data(self, data: str) -> None:
        if self.in_body:
            cleaned = data.strip()
            if cleaned:
                self.text_content.append(cleaned)


def fetch_webpage(url: str, timeout: int = 10) -> Optional[str]:
    """
    Fetch webpage content with error handling.
    
    Args:
        url: URL to fetch
        timeout: Request timeout in seconds
        
    Returns:
        HTML content as string or None if failed
    """
    try:
        # Create SSL context to handle HTTPS
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        
        # Set user agent to avoid being blocked
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        req = Request(url, headers=headers)
        with urlopen(req, timeout=timeout, context=context) as response:
            if response.status == 200:
                content_type = response.getheader('Content-Type', '')
                if 'text/html' in content_type.lower():
                    return response.read().decode('utf-8', errors='ignore')
                else:
                    print(f"Warning: Non-HTML content type: {content_type}", 
                          file=sys.stderr)
            else:
                print(f"Warning: HTTP {response.status} for {url}", 
                      file=sys.stderr)
                
    except HTTPError as e:
        print(f"HTTP Error {e.code} for {url}: {e.reason}", file=sys.stderr)
    except URLError as e:
        print(f"URL Error for {url}: {e.reason}", file=sys.stderr)
    except Exception as e:
        print(f"Error fetching {url}: {str(e)}", file=sys.stderr)
        
    return None


def extract_links_from_html(html_content: str, base_url: str, 
                           max_links: int = 50) -> List[str]:
    """
    Extract links from HTML content.
    
    Args:
        html_content: HTML content as string
        base_url: Base URL for resolving relative links
        max_links: Maximum number of links to extract
        
    Returns:
        List of unique absolute URLs
    """
    try:
        parser = LinkExtractor(base_url)
        parser.feed(html_content)
        
        # Get unique links and limit to max_links
        unique_links = list(dict.fromkeys(parser.links))
        return unique_links[:max_links]
        
    except Exception as e:
        print(f"Error parsing HTML: {str(e)}", file=sys.stderr)
        return []


def extract_text_from_html(html_content: str) -> str:
    """
    Extract clean text from HTML content.
    
    Args:
        html_content: HTML content as string
        
    Returns:
        Clean text content
    """
    try:
        # Simple text extraction using HTMLParser
        parser = LinkExtractor("")
        parser.feed(html_content)
        
        # Join text content with spaces
        text = " ".join(parser.text_content)
        
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
        
    except Exception as e:
        print(f"Error extracting text: {str(e)}", file=sys.stderr)
        return ""


def is_valid_url(url: str) -> bool:
    """
    Validate URL format.
    
    Args:
        url: URL to validate
        
    Returns:
        True if URL is valid, False otherwise
    """
    try:
        result = urlparse(url)
        return all([result.scheme in ['http', 'https'], result.netloc])
    except Exception:
        return False


def filter_links_by_domain(links: List[str], target_domain: str) -> List[str]:
    """
    Filter links to keep only those from the target domain.
    
    Args:
        links: List of URLs
        target_domain: Domain to filter by
        
    Returns:
        Filtered list of URLs
    """
    filtered = []
    for link in links:
        try:
            domain = urlparse(link).netloc
            if target_domain in domain:
                filtered.append(link)
        except Exception:
            continue
    return filtered


def collect_web_data(start_url: str, max_depth: int = 2, 
                    max_pages: int = 20, same_domain: bool = True) -> Dict[str, Any]:
    """
    Collect web data by crawling from a starting URL.
    
    Args:
        start_url: Starting URL for collection
        max_depth: Maximum crawl depth
        max_pages: Maximum number of pages to collect
        same_domain: Whether to stay within the same domain
        
    Returns:
        Dictionary containing collected data
    """
    if not is_valid_url(start_url):
        print(f"Error: Invalid URL: {start_url}", file=sys.stderr)
        return {"pages": [], "total_pages": 0, "error": "Invalid URL"}
    
    try:
        target_domain = urlparse(start_url).netloc
        visited = set()
        to_visit = [(start_url, 0)]  # (url, depth)
        collected_pages = []
        
        while to_visit and len(collected_pages) < max_pages:
            current_url, depth = to_visit.pop(0)
            
            if current_url in visited:
                continue
                
            visited.add(current_url)
            
            # Fetch the page
            html_content = fetch_webpage(current_url)
            if not html_content:
                continue
                
            # Extract text content
            text_content = extract_text_from_html(html_content)
            
            # Store page data
            page_data = {
                "url": current_url,
                "depth": depth,
                "text": text_content[:5000],  # Limit text length
                "text_length": len(text_content)
            }
            collected_pages.append(page_data)
            
            # Stop if reached max depth
            if depth >= max_depth:
                continue
                
            # Extract links for further crawling
            links = extract_links_from_html(html_content, current_url)
            
            # Filter links if staying within same domain
            if same_domain:
                links = filter_links_by_domain(links, target_domain)
            
            # Add new links to visit queue
            for link in links:
                if link not in visited and link not in [url for url, _ in to_visit]:
                    to_visit.append((link, depth + 1))
        
        return {
            "pages": collected_pages,
            "total_pages": len(collected_pages),
            "start_url": start_url,
            "max_depth": max_depth,
            "same_domain": same_domain
        }
        
    except Exception as e:
        print(f"Error during web collection: {str(e)}", file=sys.stderr)
        return {"pages": [], "total_pages": 0, "error": str(e)}


def main(start_url: str, max_depth: int = 2, max_pages: int = 20, 
         same_domain: bool = True) -> Dict[str, Any]:
    """
    Main entry point for web collection.
    
    Args:
        start_url: Starting URL for web collection
        max_depth: Maximum crawl depth (default: 2)
        max_pages: Maximum number of pages to collect (default: 20)
        same_domain: Whether to stay within the same domain (default: True)
        
    Returns:
        Dictionary with collected web data
    """
    result = collect_web_data(
        start_url=start_url,
        max_depth=max_depth,
        max_pages=max_pages,
        same_domain=same_domain
    )
    
    return result