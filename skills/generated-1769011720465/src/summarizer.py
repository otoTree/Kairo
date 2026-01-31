import json
import sys
import os
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse
import requests
from pathlib import Path

# Pre-installed packages assumption: requests is available
# If not, we'll handle gracefully

def is_valid_url(url: str) -> bool:
    """Check if a string is a valid URL."""
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except:
        return False

def fetch_page_content(url: str) -> Optional[str]:
    """Fetch content from a URL."""
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.text
    except requests.exceptions.RequestException as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Unexpected error fetching {url}: {e}", file=sys.stderr)
        return None

def extract_text_from_html(html_content: str) -> str:
    """Extract readable text from HTML content (basic implementation)."""
    # This is a simplified text extractor
    # In production, you'd want to use a proper HTML parser like BeautifulSoup
    import re
    
    # Remove script and style elements
    html_content = re.sub(r'<script.*?>.*?</script>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    html_content = re.sub(r'<style.*?>.*?</style>', '', html_content, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove HTML tags
    text = re.sub(r'<[^>]+>', ' ', html_content)
    
    # Replace multiple whitespace with single space
    text = re.sub(r'\s+', ' ', text)
    
    # Decode HTML entities (basic)
    import html
    text = html.unescape(text)
    
    return text.strip()

def summarize_text(text: str, max_length: int = 500) -> str:
    """Generate a summary of the text."""
    if not text:
        return ""
    
    # Simple summarization: take first few sentences or truncate
    sentences = text.split('.')
    summary_parts = []
    current_length = 0
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
            
        sentence_length = len(sentence)
        if current_length + sentence_length <= max_length:
            summary_parts.append(sentence)
            current_length += sentence_length + 1  # +1 for period
        else:
            # Add partial sentence if we have space
            remaining = max_length - current_length
            if remaining > 20:  # Only add if we have meaningful content
                summary_parts.append(sentence[:remaining] + "...")
            break
    
    summary = '. '.join(summary_parts)
    if summary and not summary.endswith('.'):
        summary += '.'
    
    return summary

def create_combined_document(summaries: List[Dict[str, str]], title: str = "Multi-Page Summary") -> str:
    """Create a combined document from all summaries."""
    document = f"# {title}\n\n"
    document += f"*Generated from {len(summaries)} pages*\n\n"
    
    for i, summary_data in enumerate(summaries, 1):
        document += f"## Page {i}: {summary_data.get('title', f'Page {i}')}\n\n"
        document += f"**URL:** {summary_data['url']}\n\n"
        document += f"**Summary:**\n\n{summary_data['summary']}\n\n"
        
        if 'key_points' in summary_data and summary_data['key_points']:
            document += "**Key Points:**\n\n"
            for point in summary_data['key_points']:
                document += f"- {point}\n"
            document += "\n"
        
        document += "---\n\n"
    
    return document

def extract_key_points(text: str, max_points: int = 5) -> List[str]:
    """Extract key points from text."""
    # Simple implementation: take important sentences
    sentences = [s.strip() for s in text.split('.') if s.strip()]
    
    # Filter for potentially important sentences (containing keywords or longer sentences)
    important_keywords = ['important', 'key', 'main', 'primary', 'essential', 
                         'critical', 'significant', 'major', 'crucial']
    
    key_points = []
    for sentence in sentences:
        if len(sentence.split()) > 8:  # Longer sentences often contain more information
            # Check for importance indicators
            if any(keyword in sentence.lower() for keyword in important_keywords):
                key_points.append(sentence)
            elif len(key_points) < max_points and len(sentence) > 50:
                key_points.append(sentence)
    
    # Limit to max_points
    return key_points[:max_points]

def main(
    urls: List[str],
    output_format: str = "combined_document",
    max_summary_length: int = 500,
    include_key_points: bool = True,
    document_title: str = "Multi-Page Summary"
) -> Dict[str, Any]:
    """
    Main function for multi-page summarization.
    
    Args:
        urls: List of URLs to summarize
        output_format: Format of output ("combined_document" or "individual_summaries")
        max_summary_length: Maximum length of each summary in characters
        include_key_points: Whether to include extracted key points
        document_title: Title for the combined document
    
    Returns:
        Dictionary containing the summarization results
    """
    result = {
        "success": False,
        "summaries": [],
        "combined_document": "",
        "error": None,
        "stats": {
            "total_urls": len(urls),
            "successful_fetches": 0,
            "failed_fetches": 0
        }
    }
    
    try:
        # Validate URLs
        valid_urls = []
        invalid_urls = []
        
        for url in urls:
            if is_valid_url(url):
                valid_urls.append(url)
            else:
                invalid_urls.append(url)
                print(f"Invalid URL: {url}", file=sys.stderr)
        
        if not valid_urls:
            result["error"] = "No valid URLs provided"
            return result
        
        # Process each URL
        all_summaries = []
        
        for url in valid_urls:
            try:
                # Fetch content
                content = fetch_page_content(url)
                if content is None:
                    result["stats"]["failed_fetches"] += 1
                    continue
                
                result["stats"]["successful_fetches"] += 1
                
                # Extract text
                text_content = extract_text_from_html(content)
                
                # Generate summary
                summary = summarize_text(text_content, max_summary_length)
                
                # Extract title (from URL or first line of text)
                title_from_text = text_content[:100].split('\n')[0].strip()
                page_title = title_from_text if title_from_text else os.path.basename(urlparse(url).path) or url
                
                # Prepare summary data
                summary_data = {
                    "url": url,
                    "title": page_title,
                    "summary": summary,
                    "original_length": len(text_content),
                    "summary_length": len(summary)
                }
                
                # Extract key points if requested
                if include_key_points:
                    key_points = extract_key_points(text_content)
                    summary_data["key_points"] = key_points
                
                all_summaries.append(summary_data)
                
            except Exception as e:
                print(f"Error processing {url}: {e}", file=sys.stderr)
                result["stats"]["failed_fetches"] += 1
                continue
        
        # Update result
        result["summaries"] = all_summaries
        
        # Create combined document if requested
        if output_format == "combined_document" and all_summaries:
            result["combined_document"] = create_combined_document(
                all_summaries, 
                document_title
            )
        
        result["success"] = len(all_summaries) > 0
        
        if not result["success"]:
            result["error"] = "Failed to process any URLs"
        
    except Exception as e:
        result["error"] = f"Unexpected error: {str(e)}"
        print(f"Unexpected error in main: {e}", file=sys.stderr)
    
    return result