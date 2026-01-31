import json
import sys
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse
import requests
from datetime import datetime


class JinaClient:
    """Client for interacting with Jina AI services for multi-page summarization."""
    
    def __init__(self, api_key: Optional[str] = None, base_url: str = "https://r.jina.ai/"):
        """
        Initialize Jina client.
        
        Args:
            api_key: Jina AI API key (optional for some endpoints)
            base_url: Base URL for Jina AI API
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        
        # Set headers if API key is provided
        if self.api_key:
            self.session.headers.update({
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            })
    
    def validate_url(self, url: str) -> bool:
        """
        Validate if a string is a valid URL.
        
        Args:
            url: URL string to validate
            
        Returns:
            bool: True if valid URL, False otherwise
        """
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except Exception:
            return False
    
    def fetch_page_content(self, url: str) -> Optional[str]:
        """
        Fetch content from a single URL using Jina Reader.
        
        Args:
            url: URL to fetch content from
            
        Returns:
            Optional[str]: Extracted content or None if failed
        """
        try:
            # Jina Reader endpoint
            reader_url = f"{self.base_url}/{url}"
            
            response = self.session.get(
                reader_url,
                headers={
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (compatible; JinaReader/1.0)"
                },
                timeout=30
            )
            
            if response.status_code == 200:
                # Try to parse as JSON first (Jina Reader returns JSON)
                try:
                    data = response.json()
                    return data.get('data', {}).get('content', response.text)
                except json.JSONDecodeError:
                    # If not JSON, return raw text
                    return response.text
            else:
                print(f"Failed to fetch {url}: HTTP {response.status_code}", file=sys.stderr)
                return None
                
        except requests.exceptions.Timeout:
            print(f"Timeout while fetching {url}", file=sys.stderr)
            return None
        except requests.exceptions.RequestException as e:
            print(f"Network error fetching {url}: {e}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"Unexpected error fetching {url}: {e}", file=sys.stderr)
            return None
    
    def summarize_content(self, content: str, max_length: int = 500) -> Optional[str]:
        """
        Summarize content using Jina AI's summarization capabilities.
        
        Args:
            content: Content to summarize
            max_length: Maximum length of summary
            
        Returns:
            Optional[str]: Summary text or None if failed
        """
        try:
            if not content or len(content.strip()) == 0:
                return "No content to summarize."
            
            # For simplicity, we'll use a basic extractive summarization
            # In production, you would use Jina AI's summarization API
            sentences = content.split('.')
            
            # Take first few sentences as summary
            summary_sentences = []
            current_length = 0
            
            for sentence in sentences:
                sentence = sentence.strip()
                if sentence:
                    sentence_length = len(sentence)
                    if current_length + sentence_length <= max_length:
                        summary_sentences.append(sentence)
                        current_length += sentence_length + 1  # +1 for period
                    else:
                        break
            
            summary = '. '.join(summary_sentences)
            if summary_sentences:
                summary += '.'
            
            return summary if summary else "Summary could not be generated."
            
        except Exception as e:
            print(f"Error summarizing content: {e}", file=sys.stderr)
            return None
    
    def create_combined_document(self, page_results: List[Dict[str, Any]]) -> str:
        """
        Create a combined document from multiple page summaries.
        
        Args:
            page_results: List of page result dictionaries
            
        Returns:
            str: Combined document text
        """
        try:
            document_parts = []
            
            # Header
            document_parts.append("=" * 80)
            document_parts.append("MULTI-PAGE SUMMARY REPORT")
            document_parts.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            document_parts.append(f"Total Pages: {len(page_results)}")
            document_parts.append("=" * 80)
            document_parts.append("")
            
            # Add each page summary
            for i, result in enumerate(page_results, 1):
                document_parts.append(f"PAGE {i}: {result.get('url', 'Unknown URL')}")
                document_parts.append("-" * 40)
                
                if result.get('success', False):
                    document_parts.append(f"Title: {result.get('title', 'No title')}")
                    document_parts.append("")
                    document_parts.append("SUMMARY:")
                    document_parts.append(result.get('summary', 'No summary available'))
                else:
                    document_parts.append(f"ERROR: {result.get('error', 'Unknown error')}")
                
                document_parts.append("")
                document_parts.append("")
            
            # Footer
            document_parts.append("=" * 80)
            document_parts.append("END OF REPORT")
            document_parts.append("=" * 80)
            
            return '\n'.join(document_parts)
            
        except Exception as e:
            print(f"Error creating combined document: {e}", file=sys.stderr)
            return f"Error creating document: {e}"
    
    def extract_title_from_content(self, content: str) -> str:
        """
        Extract a title from content.
        
        Args:
            content: Content to extract title from
            
        Returns:
            str: Extracted title or default
        """
        try:
            # Try to find the first line that looks like a title
            lines = content.split('\n')
            for line in lines:
                line = line.strip()
                if line and len(line) < 200 and not line.startswith(('http://', 'https://')):
                    # Remove common prefixes/suffixes
                    clean_line = line.strip('-#=* ')
                    if clean_line:
                        return clean_line[:100]  # Limit title length
        except Exception:
            pass
        
        return "Untitled Page"
    
    def process_pages(self, urls: List[str], summary_length: int = 500) -> List[Dict[str, Any]]:
        """
        Process multiple pages: fetch content and generate summaries.
        
        Args:
            urls: List of URLs to process
            summary_length: Maximum length for each summary
            
        Returns:
            List[Dict[str, Any]]: List of page results
        """
        results = []
        
        for url in urls:
            result = {
                'url': url,
                'success': False,
                'title': '',
                'summary': '',
                'error': ''
            }
            
            try:
                # Validate URL
                if not self.validate_url(url):
                    result['error'] = f"Invalid URL: {url}"
                    results.append(result)
                    continue
                
                # Fetch content
                content = self.fetch_page_content(url)
                if content is None:
                    result['error'] = "Failed to fetch content"
                    results.append(result)
                    continue
                
                # Extract title
                title = self.extract_title_from_content(content)
                
                # Generate summary
                summary = self.summarize_content(content, summary_length)
                
                if summary:
                    result.update({
                        'success': True,
                        'title': title,
                        'summary': summary
                    })
                else:
                    result['error'] = "Failed to generate summary"
                
            except Exception as e:
                result['error'] = f"Processing error: {str(e)}"
            
            results.append(result)
        
        return results


def main(
    urls: List[str],
    api_key: Optional[str] = None,
    summary_length: int = 500,
    output_format: str = "combined"
) -> Dict[str, Any]:
    """
    Main entry point for Jina multi-page summarizer.
    
    Args:
        urls: List of URLs to summarize
        api_key: Jina AI API key (optional)
        summary_length: Maximum length for each summary in characters
        output_format: Output format - "combined" or "individual"
    
    Returns:
        Dict[str, Any]: Result dictionary with summary data
    """
    # Initialize result structure
    result = {
        "success": False,
        "total_pages": len(urls),
        "processed_pages": 0,
        "failed_pages": 0,
        "document": "",
        "page_summaries": [],
        "error": ""
    }
    
    try:
        # Validate input
        if not urls:
            result["error"] = "No URLs provided"
            return result
        
        # Initialize client
        client = JinaClient(api_key=api_key)
        
        # Process pages
        page_results = client.process_pages(urls, summary_length)
        
        # Update result statistics
        processed = [r for r in page_results if r.get('success', False)]
        failed = [r for r in page_results if not r.get('success', False)]
        
        result.update({
            "success": True,
            "processed_pages": len(processed),
            "failed_pages": len(failed),
            "page_summaries": page_results
        })
        
        # Generate output document based on format
        if output_format == "combined":
            result["document"] = client.create_combined_document(page_results)
        else:  # individual format
            # For individual format, create a simple list of summaries
            doc_parts = []
            for i, page_result in enumerate(page_results, 1):
                if page_result.get('success', False):
                    doc_parts.append(f"Page {i}: {page_result.get('title')}")
                    doc_parts.append(f"URL: {page_result.get('url')}")
                    doc_parts.append(f"Summary: {page_result.get('summary')}")
                    doc_parts.append("---")
                else:
                    doc_parts.append(f"Page {i}: FAILED")
                    doc_parts.append(f"URL: {page_result.get('url')}")
                    doc_parts.append(f"Error: {page_result.get('error')}")
                    doc_parts.append("---")
            
            result["document"] = '\n'.join(doc_parts)
        
    except Exception as e:
        result["error"] = f"Unexpected error: {str(e)}"
        print(f"Error in main function: {e}", file=sys.stderr)
    
    return result