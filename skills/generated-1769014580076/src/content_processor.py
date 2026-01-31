import json
import sys
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime


def extract_content_from_url(url: str) -> Dict[str, Any]:
    """
    Extract content from a given URL.
    
    Args:
        url: The URL to extract content from
        
    Returns:
        Dictionary containing extracted content and metadata
    """
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        
        # Extract title
        title = soup.title.string if soup.title else ""
        
        # Extract meta description
        description = ""
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc and meta_desc.get("content"):
            description = meta_desc["content"]
        
        # Extract main content - try to find the main article/content area
        content = ""
        
        # Try common content selectors
        content_selectors = [
            "article", "main", ".content", ".article", ".post-content",
            "#content", "#main", ".entry-content", ".post-body"
        ]
        
        for selector in content_selectors:
            element = soup.select_one(selector)
            if element:
                content = element.get_text(strip=True, separator=' ')
                if len(content) > 100:  # Ensure we have meaningful content
                    break
        
        # If no specific content area found, get body text
        if not content or len(content) < 100:
            body = soup.body
            if body:
                content = body.get_text(strip=True, separator=' ')
        
        # Clean up content
        content = re.sub(r'\s+', ' ', content).strip()
        
        # Extract links
        links = []
        for link in soup.find_all('a', href=True):
            href = link.get('href')
            text = link.get_text(strip=True)
            if href and text and not href.startswith(('#', 'javascript:')):
                # Convert relative URLs to absolute
                if not href.startswith(('http://', 'https://')):
                    parsed_url = urlparse(url)
                    href = f"{parsed_url.scheme}://{parsed_url.netloc}{href if href.startswith('/') else '/' + href}"
                links.append({
                    "text": text[:100],  # Limit text length
                    "url": href
                })
        
        # Extract images
        images = []
        for img in soup.find_all('img', src=True):
            src = img.get('src')
            alt = img.get('alt', '')
            if src:
                # Convert relative URLs to absolute
                if not src.startswith(('http://', 'https://', 'data:')):
                    parsed_url = urlparse(url)
                    src = f"{parsed_url.scheme}://{parsed_url.netloc}{src if src.startswith('/') else '/' + src}"
                images.append({
                    "src": src,
                    "alt": alt[:200]  # Limit alt text length
                })
        
        # Extract metadata
        metadata = {
            "url": url,
            "title": title[:500] if title else "",
            "description": description[:1000] if description else "",
            "content_length": len(content),
            "extracted_at": datetime.now().isoformat(),
            "status_code": response.status_code,
            "content_type": response.headers.get('content-type', ''),
            "encoding": response.encoding
        }
        
        return {
            "metadata": metadata,
            "content": content[:10000],  # Limit content length
            "links": links[:50],  # Limit number of links
            "images": images[:20]  # Limit number of images
        }
        
    except requests.exceptions.RequestException as e:
        print(f"Error fetching URL {url}: {e}", file=sys.stderr)
        return {
            "metadata": {
                "url": url,
                "error": str(e),
                "extracted_at": datetime.now().isoformat()
            },
            "content": "",
            "links": [],
            "images": []
        }
    except Exception as e:
        print(f"Error processing URL {url}: {e}", file=sys.stderr)
        return {
            "metadata": {
                "url": url,
                "error": str(e),
                "extracted_at": datetime.now().isoformat()
            },
            "content": "",
            "links": [],
            "images": []
        }


def main(
    urls: List[str],
    extract_content: bool = True,
    extract_links: bool = True,
    extract_images: bool = True,
    content_limit: int = 10000,
    max_links: int = 50,
    max_images: int = 20
) -> Dict[str, Any]:
    """
    Main function to process web content from given URLs.
    
    Args:
        urls: List of URLs to process
        extract_content: Whether to extract main content
        extract_links: Whether to extract links
        extract_images: Whether to extract images
        content_limit: Maximum character limit for content
        max_links: Maximum number of links to extract per URL
        max_images: Maximum number of images to extract per URL
        
    Returns:
        Dictionary containing processed results for all URLs
    """
    results = []
    successful_count = 0
    failed_count = 0
    
    for url in urls:
        if not url:
            continue
            
        try:
            # Validate URL format
            parsed = urlparse(url)
            if not all([parsed.scheme, parsed.netloc]):
                print(f"Invalid URL format: {url}", file=sys.stderr)
                failed_count += 1
                results.append({
                    "url": url,
                    "status": "error",
                    "error": "Invalid URL format",
                    "metadata": {
                        "url": url,
                        "error": "Invalid URL format",
                        "extracted_at": datetime.now().isoformat()
                    }
                })
                continue
            
            # Extract content from URL
            extracted_data = extract_content_from_url(url)
            
            # Apply limits based on parameters
            if not extract_content:
                extracted_data["content"] = ""
            
            if not extract_links:
                extracted_data["links"] = []
            elif len(extracted_data["links"]) > max_links:
                extracted_data["links"] = extracted_data["links"][:max_links]
            
            if not extract_images:
                extracted_data["images"] = []
            elif len(extracted_data["images"]) > max_images:
                extracted_data["images"] = extracted_data["images"][:max_images]
            
            # Limit content length
            if len(extracted_data["content"]) > content_limit:
                extracted_data["content"] = extracted_data["content"][:content_limit]
            
            # Determine status
            if "error" in extracted_data["metadata"]:
                status = "error"
                failed_count += 1
            else:
                status = "success"
                successful_count += 1
            
            result = {
                "url": url,
                "status": status,
                **extracted_data
            }
            
            results.append(result)
            
        except Exception as e:
            print(f"Unexpected error processing URL {url}: {e}", file=sys.stderr)
            failed_count += 1
            results.append({
                "url": url,
                "status": "error",
                "error": str(e),
                "metadata": {
                    "url": url,
                    "error": str(e),
                    "extracted_at": datetime.now().isoformat()
                }
            })
    
    # Return final result
    return {
        "total_urls": len(urls),
        "successful": successful_count,
        "failed": failed_count,
        "results": results,
        "processed_at": datetime.now().isoformat()
    }