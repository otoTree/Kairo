#!/usr/bin/env python3
"""
Script to visit East Money (东方财富) homepage and capture information.
"""

from playwright.sync_api import sync_playwright
import time
import os

def visit_eastmoney_homepage():
    """Visit East Money homepage and capture information."""
    print("Starting to visit East Money (东方财富) homepage...")
    
    with sync_playwright() as p:
        # Launch browser in headless mode
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        try:
            # Navigate to East Money homepage
            print("Navigating to https://www.eastmoney.com/...")
            page.goto('https://www.eastmoney.com/', timeout=30000)
            
            # Wait for page to load
            print("Waiting for page to load...")
            page.wait_for_load_state('networkidle')
            
            # Get page title
            title = page.title()
            print(f"Page title: {title}")
            
            # Get current URL
            current_url = page.url
            print(f"Current URL: {current_url}")
            
            # Take a screenshot
            screenshot_path = '/tmp/eastmoney_homepage.png'
            page.screenshot(path=screenshot_path, full_page=True)
            print(f"Screenshot saved to: {screenshot_path}")
            
            # Get some basic page information
            print("\n=== Page Information ===")
            
            # Get meta description if available
            meta_description = page.locator('meta[name="description"]').get_attribute('content')
            if meta_description:
                print(f"Meta description: {meta_description[:200]}...")
            
            # Count some elements
            links_count = page.locator('a').count()
            print(f"Number of links on page: {links_count}")
            
            # Get some visible text content (first 500 chars)
            body_text = page.locator('body').inner_text()
            print(f"\nFirst 500 characters of page content:")
            print(body_text[:500])
            
            # Look for specific elements that might be interesting
            print("\n=== Looking for key sections ===")
            
            # Check for stock market related elements
            stock_elements = page.locator('text=/.*股.*|.*指数.*|.*行情.*|.*财经.*/').all()
            print(f"Found {len(stock_elements)} elements with stock/market related text")
            
            # Check for navigation elements
            nav_elements = page.locator('nav, .nav, .navigation, #nav').all()
            print(f"Found {len(nav_elements)} navigation elements")
            
            # Get some headlines if available
            headlines = page.locator('h1, h2, h3').all()
            print(f"\nFound {len(headlines)} headlines:")
            for i, headline in enumerate(headlines[:5]):  # Show first 5
                try:
                    text = headline.inner_text().strip()
                    if text:
                        print(f"  {i+1}. {text[:100]}...")
                except:
                    pass
            
            print("\n=== Summary ===")
            print(f"Successfully visited East Money homepage")
            print(f"Page appears to be loaded correctly")
            print(f"Check the screenshot at {screenshot_path} for visual confirmation")
            
        except Exception as e:
            print(f"Error occurred: {e}")
            print("Trying alternative approach...")
            
            # Try with a longer timeout
            try:
                page.goto('https://www.eastmoney.com/', timeout=60000)
                page.wait_for_load_state('networkidle')
                print("Successfully loaded page with longer timeout")
                print(f"Title: {page.title()}")
            except Exception as e2:
                print(f"Still failed: {e2}")
                
        finally:
            # Close browser
            browser.close()
            print("\nBrowser closed.")

if __name__ == "__main__":
    visit_eastmoney_homepage()