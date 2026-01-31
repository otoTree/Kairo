#!/usr/bin/env python3
"""
Simple script to fetch East Money homepage content using requests.
"""

import requests
from bs4 import BeautifulSoup
import sys

def fetch_eastmoney_homepage():
    """Fetch East Money homepage content."""
    print("Fetching East Money (东方财富) homepage...")
    
    url = "https://www.eastmoney.com/"
    
    # Set headers to mimic a browser
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    try:
        print(f"Making request to: {url}")
        response = requests.get(url, headers=headers, timeout=30)
        
        print(f"Status code: {response.status_code}")
        print(f"Content length: {len(response.content)} bytes")
        
        if response.status_code == 200:
            # Parse HTML with BeautifulSoup
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Get page title
            title = soup.title.string if soup.title else "No title found"
            print(f"\n=== Page Title ===")
            print(title)
            
            # Get meta description
            meta_desc = soup.find('meta', attrs={'name': 'description'})
            if meta_desc and meta_desc.get('content'):
                print(f"\n=== Meta Description ===")
                print(meta_desc['content'][:200] + "...")
            
            # Get all meta tags for more info
            print(f"\n=== Meta Tags ===")
            meta_tags = soup.find_all('meta')
            for meta in meta_tags[:10]:  # Show first 10 meta tags
                name = meta.get('name') or meta.get('property') or meta.get('http-equiv')
                content = meta.get('content')
                if name and content:
                    print(f"{name}: {content[:100]}...")
            
            # Get headings
            print(f"\n=== Headings (h1-h3) ===")
            for i in range(1, 4):
                headings = soup.find_all(f'h{i}')
                if headings:
                    print(f"\nH{i} headings:")
                    for h in headings[:5]:  # Show first 5 of each
                        text = h.get_text(strip=True)
                        if text:
                            print(f"  • {text[:100]}...")
            
            # Get links count
            links = soup.find_all('a')
            print(f"\n=== Links ===")
            print(f"Total links found: {len(links)}")
            
            # Show some interesting links
            print(f"\nFirst 10 links:")
            for i, link in enumerate(links[:10]):
                href = link.get('href', '')
                text = link.get_text(strip=True)
                if text or href:
                    print(f"  {i+1}. Text: {text[:50]}...")
                    print(f"     URL: {href[:100]}...")
            
            # Get some text content
            print(f"\n=== Sample Text Content ===")
            # Get body text
            body = soup.find('body')
            if body:
                body_text = body.get_text(strip=True, separator=' ')
                print("First 1000 characters of body text:")
                print(body_text[:1000] + "...")
            
            # Look for specific keywords
            print(f"\n=== Keywords Search ===")
            keywords = ['股票', '指数', '行情', '财经', '基金', '证券', '投资', '交易']
            all_text = soup.get_text()
            for keyword in keywords:
                count = all_text.count(keyword)
                if count > 0:
                    print(f"'{keyword}' appears {count} times")
            
            # Get script and style info
            scripts = soup.find_all('script')
            styles = soup.find_all('style')
            print(f"\n=== Page Structure ===")
            print(f"Script tags: {len(scripts)}")
            print(f"Style tags: {len(styles)}")
            
            # Check for common East Money elements
            print(f"\n=== East Money Specific Elements ===")
            # Look for common East Money class names or IDs
            eastmoney_elements = soup.find_all(class_=lambda x: x and ('eastmoney' in x.lower() or 'em' in x.lower()))
            print(f"Elements with 'eastmoney' or 'em' in class: {len(eastmoney_elements)}")
            
        else:
            print(f"Failed to fetch page. Status code: {response.status_code}")
            print(f"Response headers: {response.headers}")
            
    except requests.exceptions.Timeout:
        print("Request timed out after 30 seconds")
    except requests.exceptions.ConnectionError as e:
        print(f"Connection error: {e}")
    except requests.exceptions.RequestException as e:
        print(f"Request error: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")
    
    print("\n=== Summary ===")
    print("Completed fetching East Money homepage content.")

if __name__ == "__main__":
    fetch_eastmoney_homepage()