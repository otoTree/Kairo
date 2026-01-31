import json
import os
import sys
from typing import List, Dict, Any, Optional
from pathlib import Path
import urllib.request
import urllib.error
from urllib.parse import urlparse
import hashlib
import time
import tempfile
import mimetypes

# Pre-installed packages assumption
try:
    from bs4 import BeautifulSoup
    HAS_BEAUTIFULSOUP = True
except ImportError:
    HAS_BEAUTIFULSOUP = False
    print("Warning: BeautifulSoup not available, HTML parsing limited", file=sys.stderr)

try:
    import markdown
    HAS_MARKDOWN = True
except ImportError:
    HAS_MARKDOWN = False
    print("Warning: markdown not available, markdown generation limited", file=sys.stderr)

try:
    from jinja2 import Template
    HAS_JINJA2 = True
except ImportError:
    HAS_JINJA2 = False
    print("Warning: Jinja2 not available, template rendering limited", file=sys.stderr)


class DocumentGenerator:
    """Generate summary documents from multiple web pages."""
    
    def __init__(self, output_dir: str = "output"):
        """Initialize the document generator.
        
        Args:
            output_dir: Directory to save generated documents
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Cache for downloaded content
        self.cache_dir = Path(tempfile.gettempdir()) / "jina_summarizer_cache"
        self.cache_dir.mkdir(exist_ok=True)
        
    def fetch_url_content(self, url: str, timeout: int = 10) -> Optional[str]:
        """Fetch content from a URL with caching.
        
        Args:
            url: URL to fetch
            timeout: Request timeout in seconds
            
        Returns:
            HTML content or None if failed
        """
        # Generate cache key
        url_hash = hashlib.md5(url.encode()).hexdigest()
        cache_file = self.cache_dir / f"{url_hash}.html"
        
        # Check cache first
        if cache_file.exists():
            cache_age = time.time() - cache_file.stat().st_mtime
            if cache_age < 3600:  # 1 hour cache
                try:
                    with open(cache_file, 'r', encoding='utf-8') as f:
                        return f.read()
                except Exception as e:
                    print(f"Cache read error for {url}: {e}", file=sys.stderr)
        
        # Fetch from network
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            req = urllib.request.Request(url, headers=headers)
            
            with urllib.request.urlopen(req, timeout=timeout) as response:
                content_type = response.headers.get('Content-Type', '')
                charset = 'utf-8'
                
                # Try to detect charset
                if 'charset=' in content_type:
                    charset = content_type.split('charset=')[-1].split(';')[0]
                
                html_content = response.read().decode(charset, errors='replace')
                
                # Save to cache
                try:
                    with open(cache_file, 'w', encoding='utf-8') as f:
                        f.write(html_content)
                except Exception as e:
                    print(f"Cache write error for {url}: {e}", file=sys.stderr)
                
                return html_content
                
        except urllib.error.URLError as e:
            print(f"Failed to fetch {url}: {e}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"Error fetching {url}: {e}", file=sys.stderr)
            return None
    
    def extract_text_from_html(self, html_content: str) -> str:
        """Extract clean text from HTML content.
        
        Args:
            html_content: HTML content string
            
        Returns:
            Clean text content
        """
        if not HAS_BEAUTIFULSOUP:
            # Fallback: simple text extraction
            import re
            # Remove script and style tags
            html_content = re.sub(r'<script.*?</script>', '', html_content, flags=re.DOTALL)
            html_content = re.sub(r'<style.*?</style>', '', html_content, flags=re.DOTALL)
            # Remove HTML tags
            text = re.sub(r'<[^>]+>', ' ', html_content)
            # Normalize whitespace
            text = re.sub(r'\s+', ' ', text).strip()
            return text
        
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Remove unwanted elements
            for element in soup(['script', 'style', 'nav', 'footer', 'header', 'aside']):
                element.decompose()
            
            # Get text
            text = soup.get_text(separator=' ', strip=True)
            
            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split())
            text = ' '.join(chunk for chunk in chunks if chunk)
            
            return text
        except Exception as e:
            print(f"HTML parsing error: {e}", file=sys.stderr)
            return html_content
    
    def extract_title_from_html(self, html_content: str) -> str:
        """Extract title from HTML content.
        
        Args:
            html_content: HTML content string
            
        Returns:
            Page title or empty string
        """
        if not HAS_BEAUTIFULSOUP:
            # Simple regex fallback
            import re
            match = re.search(r'<title[^>]*>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
            if match:
                title = re.sub(r'<[^>]+>', '', match.group(1)).strip()
                return title[:200]  # Limit length
            return ""
        
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            title_tag = soup.find('title')
            if title_tag:
                title = title_tag.get_text(strip=True)
                return title[:200]  # Limit length
            return ""
        except Exception as e:
            print(f"Title extraction error: {e}", file=sys.stderr)
            return ""
    
    def summarize_text(self, text: str, max_length: int = 500) -> str:
        """Create a summary from text.
        
        Args:
            text: Input text
            max_length: Maximum summary length
            
        Returns:
            Summarized text
        """
        if not text:
            return ""
        
        # Simple summarization: take first few sentences
        sentences = text.split('. ')
        
        if len(sentences) <= 3:
            return text[:max_length]
        
        # Take first 3 sentences or until max_length
        summary_parts = []
        current_length = 0
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
                
            sentence_with_period = sentence + '. '
            if current_length + len(sentence_with_period) <= max_length:
                summary_parts.append(sentence)
                current_length += len(sentence_with_period)
            else:
                break
            
            if len(summary_parts) >= 3:
                break
        
        summary = '. '.join(summary_parts)
        if summary and not summary.endswith('.'):
            summary += '.'
        
        return summary[:max_length]
    
    def process_url(self, url: str) -> Dict[str, Any]:
        """Process a single URL and extract information.
        
        Args:
            url: URL to process
            
        Returns:
            Dictionary with processed information
        """
        result = {
            'url': url,
            'title': '',
            'content': '',
            'summary': '',
            'success': False,
            'error': None
        }
        
        html_content = self.fetch_url_content(url)
        if not html_content:
            result['error'] = 'Failed to fetch URL'
            return result
        
        result['title'] = self.extract_title_from_html(html_content)
        full_text = self.extract_text_from_html(html_content)
        result['content'] = full_text[:5000]  # Limit content length
        result['summary'] = self.summarize_text(full_text)
        result['success'] = True
        
        return result
    
    def generate_markdown(self, pages: List[Dict[str, Any]], 
                         document_title: str = "Multi-Page Summary") -> str:
        """Generate markdown document from processed pages.
        
        Args:
            pages: List of processed page dictionaries
            document_title: Title for the generated document
            
        Returns:
            Markdown content
        """
        markdown_lines = [f"# {document_title}\n"]
        markdown_lines.append(f"*Generated on: {time.strftime('%Y-%m-%d %H:%M:%S')}*\n")
        
        successful_pages = [p for p in pages if p.get('success', False)]
        failed_pages = [p for p in pages if not p.get('success', False)]
        
        markdown_lines.append(f"## Summary\n")
        markdown_lines.append(f"Total pages processed: {len(pages)}\n")
        markdown_lines.append(f"Successfully processed: {len(successful_pages)}\n")
        markdown_lines.append(f"Failed: {len(failed_pages)}\n")
        
        if successful_pages:
            markdown_lines.append(f"## Pages Summary\n")
            
            for i, page in enumerate(successful_pages, 1):
                title = page.get('title', 'No Title')
                url = page.get('url', '')
                summary = page.get('summary', '')
                
                markdown_lines.append(f"### {i}. {title}\n")
                markdown_lines.append(f"**URL:** {url}\n")
                markdown_lines.append(f"**Summary:** {summary}\n")
                
                # Add full content if available and not too long
                content = page.get('content', '')
                if content and len(content) < 1000:
                    markdown_lines.append(f"**Excerpt:** {content[:500]}...\n")
                
                markdown_lines.append("\n---\n")
        
        if failed_pages:
            markdown_lines.append(f"## Failed Pages\n")
            for page in failed_pages:
                url = page.get('url', '')
                error = page.get('error', 'Unknown error')
                markdown_lines.append(f"- {url}: {error}\n")
        
        return '\n'.join(markdown_lines)
    
    def generate_html(self, pages: List[Dict[str, Any]], 
                     document_title: str = "Multi-Page Summary") -> str:
        """Generate HTML document from processed pages.
        
        Args:
            pages: List of processed page dictionaries
            document_title: Title for the generated document
            
        Returns:
            HTML content
        """
        if HAS_JINJA2:
            # Try to use template from assets
            template_path = Path("assets") / "template.html"
            if template_path.exists():
                try:
                    with open(template_path, 'r', encoding='utf-8') as f:
                        template_content = f.read()
                    template = Template(template_content)
                    
                    successful_pages = [p for p in pages if p.get('success', False)]
                    failed_pages = [p for p in pages if not p.get('success', False)]
                    
                    return template.render(
                        title=document_title,
                        timestamp=time.strftime('%Y-%m-%d %H:%M:%S'),
                        total_pages=len(pages),
                        successful_count=len(successful_pages),
                        failed_count=len(failed_pages),
                        successful_pages=successful_pages,
                        failed_pages=failed_pages
                    )
                except Exception as e:
                    print(f"Template rendering error: {e}", file=sys.stderr)
        
        # Fallback: simple HTML generation
        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{document_title}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }}
        h1 {{ color: #333; border-bottom: 2px solid #eee; }}
        h2 {{ color: #555; }}
        h3 {{ color: #777; }}
        .page {{ margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }}
        .url {{ color: #0066cc; word-break: break-all; }}
        .summary {{ background: #f9f9f9; padding: 10px; border-radius: 3px; }}
        .error {{ color: #cc0000; }}
    </style>
</head>
<body>
    <h1>{document_title}</h1>
    <p><em>Generated on: {time.strftime('%Y-%m-%d %H:%M:%S')}</em></p>
"""
        
        successful_pages = [p for p in pages if p.get('success', False)]
        failed_pages = [p for p in pages if not p.get('success', False)]
        
        html += f"""
    <h2>Summary</h2>
    <p>Total pages processed: {len(pages)}</p>
    <p>Successfully processed: {len(successful_pages)}</p>
    <p>Failed: {len(failed_pages)}</p>
"""
        
        if successful_pages:
            html += """
    <h2>Pages Summary</h2>
"""
            for i, page in enumerate(successful_pages, 1):
                title = page.get('title', 'No Title')
                url = page.get('url', '')
                summary = page.get('summary', '')
                content = page.get('content', '')
                
                html += f"""
    <div class="page">
        <h3>{i}. {title}</h3>
        <p class="url"><strong>URL:</strong> <a href="{url}" target="_blank">{url}</a></p>
        <div class="summary">
            <strong>Summary:</strong> {summary}
        </div>
"""
                if content and len(content) < 1000:
                    html += f"""
        <p><strong>Excerpt:</strong> {content[:500]}...</p>
"""
                html += """
    </div>
"""
        
        if failed_pages:
            html += """
    <h2>Failed Pages</h2>
    <ul>
"""
            for page in failed_pages:
                url = page.get('url', '')
                error = page.get('error', 'Unknown error')
                html += f"""
        <li class="error">{url}: {error}</li>
"""
            html += """
    </ul>
"""
        
        html += """
</body>
</html>"""
        
        return html
    
    def save_document(self, content: str, filename: str, format_type: str = "markdown") -> str:
        """Save document to file.
        
        Args:
            content: Document content
            filename: Base filename (without extension)
            format_type: Document format (markdown, html, or txt)
            
        Returns:
            Path to saved file
        """
        if format_type == "html":
            ext = ".html"
        elif format_type == "markdown":
            ext = ".md"
        else:
            ext = ".txt"
        
        filepath = self.output_dir / f"{filename}{ext}"
        
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return str(filepath)
        except Exception as e:
            print(f"Error saving document: {e}", file=sys.stderr)
            return ""


def main(
    urls: List[str],
    output_format: str = "markdown",
    document_title: str = "Multi-Page Summary",
    enable_caching: bool = True,
    timeout: int = 10
) -> Dict[str, Any]:
    """Main entry point for the document generator skill.
    
    Args:
        urls: List of URLs to process and summarize
        output_format: Output format - "markdown", "html", or "txt"
        document_title: Title for the generated document
        enable_caching: Enable caching of downloaded content
        timeout: Timeout for URL requests in seconds
        
    Returns:
        Dictionary containing:
        - success: Boolean indicating overall success
        - document_path: Path to generated document
        - pages_processed: Number of pages successfully processed
        - total_pages: Total number of pages attempted
        - error: Error message if any
    """
    result = {
        "success": False,
        "document_path": "",
        "pages_processed": 0,
        "total_pages": 0,
        "error": None
    }
    
    try:
        # Validate input
        if not urls:
            result["error"] = "No URLs provided"
            return result
        
        if output_format not in ["markdown", "html", "txt"]:
            result["error"] = f"Invalid output format: {output_format}"
            return result
        
        # Initialize generator
        generator = DocumentGenerator()
        
        # Process each URL
        processed_pages = []
        for url in urls:
            print(f"Processing: {url}", file=sys.stderr)
            page_result = generator.process_url(url)
            processed_pages.append(page_result)
        
        # Count successful pages
        successful_pages = [p for p in processed_pages if p.get('success', False)]
        
        # Generate document
        if output_format == "html":
            document_content = generator.generate_html(processed_pages, document_title)
        elif output_format == "markdown":
            document_content = generator.generate_markdown(processed_pages, document_title)
        else:  # txt format
            # Simple text format
            lines = [f"{document_title}", "=" * len(document_title), ""]
            for page in processed_pages:
                if page.get('success', False):
                    lines.append(f"URL: {page.get('url', '')}")
                    lines.append(f"Title: {page.get('title', '')}")
                    lines.append(f"Summary: {page.get('summary', '')}")
                    lines.append("")
            document_content = '\n'.join(lines)
        
        # Save document
        timestamp = time.strftime("%Y%m%d_%H%M%S