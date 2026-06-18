#!/usr/bin/env python3
"""
Backend API Testing for Nova AI Assistant - Advanced Features
Tests: Personal Finance Brain, Personal Digital Twin, AI Chief of Staff
"""
import requests
import json
import sys
from datetime import datetime

# Backend URL - using localhost since we're testing from inside the container
BASE_URL = "http://localhost:8001/api"

# Color codes for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def print_test(name, status, details=""):
    """Print test result with color coding."""
    color = GREEN if status == "PASS" else RED if status == "FAIL" else YELLOW
    print(f"{color}[{status}]{RESET} {name}")
    if details:
        print(f"      {details}")

def test_endpoint(method, endpoint, data=None, expected_status=200, test_name=""):
    """Generic endpoint tester."""
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, timeout=30)
        elif method == "POST":
            response = requests.post(url, json=data, timeout=30)
        else:
            return False, f"Unsupported method: {method}"
        
        if response.status_code != expected_status:
            return False, f"Status {response.status_code}, expected {expected_status}"
        
        try:
            json_data = response.json()
            return True, json_data
        except:
            return False, "Invalid JSON response"
    
    except requests.exceptions.Timeout:
        return False, "Request timeout (30s)"
    except requests.exceptions.ConnectionError:
        return False, "Connection error"
    except Exception as e:
        return False, f"Error: {str(e)}"

def main():
    print(f"\n{BLUE}{'='*70}{RESET}")
    print(f"{BLUE}Nova AI Assistant - Advanced Features Testing{RESET}")
    print(f"{BLUE}Testing Backend: {BASE_URL}{RESET}")
    print(f"{BLUE}{'='*70}{RESET}\n")
    
    total_tests = 0
    passed_tests = 0
    failed_tests = []
    
    # ==================== PERSONAL FINANCE BRAIN ====================
    print(f"\n{BLUE}{'='*70}{RESET}")
    print(f"{BLUE}1. PERSONAL FINANCE BRAIN{RESET}")
    print(f"{BLUE}{'='*70}{RESET}\n")
    
    # Test 1: Process Bank Notification
    total_tests += 1
    test_name = "Process Bank Notification (POST /finance/process-notification)"
    notification_data = {
        "title": "HDFC Bank",
        "text": "Rs.750 debited to Zomato via UPI on 18-Jun-26. Ref: 123456789",
        "app_name": "HDFC"
    }
    success, result = test_endpoint("POST", "/finance/process-notification", notification_data, 200, test_name)
    if success:
        if result.get("is_transaction") and result.get("transaction"):
            tx = result["transaction"]
            if tx.get("amount") == 750 and tx.get("direction") == "debit" and tx.get("category"):
                print_test(test_name, "PASS", f"Transaction detected: ₹{tx['amount']} to {tx.get('merchant', 'Unknown')} (Category: {tx.get('category')})")
                passed_tests += 1
            else:
                print_test(test_name, "FAIL", f"Transaction data incomplete or incorrect: {tx}")
                failed_tests.append(test_name)
        else:
            print_test(test_name, "FAIL", f"Transaction not detected: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 2: Get Spending Summary
    total_tests += 1
    test_name = "Get Spending Summary (GET /finance/spending-summary)"
    success, result = test_endpoint("GET", "/finance/spending-summary?days=30", None, 200, test_name)
    if success:
        if "has_data" in result:
            if result["has_data"]:
                summary = result.get("summary", {})
                print_test(test_name, "PASS", f"Summary: ₹{summary.get('total_spent', 0)} spent, {summary.get('transaction_count', 0)} transactions")
                passed_tests += 1
            else:
                print_test(test_name, "PASS", f"No data yet: {result.get('message', 'No transactions')}")
                passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Invalid response structure: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 3: Get Spending Insights
    total_tests += 1
    test_name = "Get Spending Insights (GET /finance/insights)"
    success, result = test_endpoint("GET", "/finance/insights?days=30", None, 200, test_name)
    if success:
        if isinstance(result, list):
            print_test(test_name, "PASS", f"Insights: {len(result)} insights generated")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Expected list, got: {type(result)}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 4: Get Category Breakdown
    total_tests += 1
    test_name = "Get Category Breakdown (GET /finance/categories)"
    success, result = test_endpoint("GET", "/finance/categories?days=30", None, 200, test_name)
    if success:
        if "categories" in result and isinstance(result["categories"], list):
            print_test(test_name, "PASS", f"Categories: {len(result['categories'])} categories found")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Invalid response structure: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 5: Get Recurring Transactions
    total_tests += 1
    test_name = "Get Recurring Transactions (GET /finance/recurring)"
    success, result = test_endpoint("GET", "/finance/recurring", None, 200, test_name)
    if success:
        if isinstance(result, list):
            print_test(test_name, "PASS", f"Recurring: {len(result)} recurring transactions detected")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Expected list, got: {type(result)}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # ==================== PERSONAL DIGITAL TWIN ====================
    print(f"\n{BLUE}{'='*70}{RESET}")
    print(f"{BLUE}2. PERSONAL DIGITAL TWIN{RESET}")
    print(f"{BLUE}{'='*70}{RESET}\n")
    
    # Test 6: Get User Profile
    total_tests += 1
    test_name = "Get User Profile (GET /twin/profile)"
    success, result = test_endpoint("GET", "/twin/profile", None, 200, test_name)
    if success:
        if "writing_style" in result and "priorities" in result:
            ws = result["writing_style"]
            print_test(test_name, "PASS", f"Profile: Formality={ws.get('formality', 0):.2f}, Verbosity={ws.get('verbosity', 0):.2f}")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Invalid profile structure: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 7: Learn from Message
    total_tests += 1
    test_name = "Learn from Message (POST /twin/learn)"
    learn_data = {
        "message": "Hey! Thanks so much for the help 😊 Really appreciate it!",
        "context": "chat"
    }
    success, result = test_endpoint("POST", "/twin/learn", learn_data, 200, test_name)
    if success:
        if result.get("learned"):
            updates = result.get("updates", {})
            print_test(test_name, "PASS", f"Learned: Formality={updates.get('formality')}, Emoji={updates.get('emoji_usage')}")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Learning failed: {result.get('reason', 'Unknown')}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 8: Get Style Prompt
    total_tests += 1
    test_name = "Get Style Prompt (GET /twin/style-prompt)"
    success, result = test_endpoint("GET", "/twin/style-prompt", None, 200, test_name)
    if success:
        if "style_prompt" in result and isinstance(result["style_prompt"], str):
            prompt = result["style_prompt"]
            print_test(test_name, "PASS", f"Style: {prompt[:80]}...")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Invalid response: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 9: Track Contact Interaction
    total_tests += 1
    test_name = "Track Contact Interaction (POST /twin/contact-interaction)"
    contact_data = {
        "contact_name": "Vijay Kumar",
        "relationship": "colleague"
    }
    success, result = test_endpoint("POST", "/twin/contact-interaction", contact_data, 200, test_name)
    if success:
        if result.get("ok"):
            print_test(test_name, "PASS", "Contact interaction tracked successfully")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Unexpected response: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 10: Learn Response Template
    total_tests += 1
    test_name = "Learn Response Template (POST /twin/learn-response)"
    template_data = {
        "context": "meeting_invite",
        "response": "Thanks for the invite! Let me check my calendar and get back to you shortly."
    }
    success, result = test_endpoint("POST", "/twin/learn-response", template_data, 200, test_name)
    if success:
        if result.get("ok"):
            print_test(test_name, "PASS", "Response template learned successfully")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Unexpected response: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # ==================== AI CHIEF OF STAFF ====================
    print(f"\n{BLUE}{'='*70}{RESET}")
    print(f"{BLUE}3. AI CHIEF OF STAFF{RESET}")
    print(f"{BLUE}{'='*70}{RESET}\n")
    
    # Test 11: Get Morning Briefing
    total_tests += 1
    test_name = "Get Morning Briefing (GET /chief/morning-briefing)"
    success, result = test_endpoint("GET", "/chief/morning-briefing?tz_offset=0", None, 200, test_name)
    if success:
        if "greeting" in result and "sections" in result and "suggested_plan" in result:
            greeting = result.get("greeting", "")
            sections = result.get("sections", [])
            plan = result.get("suggested_plan", [])
            print_test(test_name, "PASS", f"Briefing: {greeting}, {len(sections)} sections, {len(plan)} plan items")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Invalid briefing structure: {result}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # Test 12: Get Smart Suggestions
    total_tests += 1
    test_name = "Get Smart Suggestions (GET /chief/suggestions)"
    success, result = test_endpoint("GET", "/chief/suggestions?context=", None, 200, test_name)
    if success:
        if isinstance(result, list):
            print_test(test_name, "PASS", f"Suggestions: {len(result)} smart suggestions generated")
            passed_tests += 1
        else:
            print_test(test_name, "FAIL", f"Expected list, got: {type(result)}")
            failed_tests.append(test_name)
    else:
        print_test(test_name, "FAIL", result)
        failed_tests.append(test_name)
    
    # ==================== SUMMARY ====================
    print(f"\n{BLUE}{'='*70}{RESET}")
    print(f"{BLUE}TEST SUMMARY{RESET}")
    print(f"{BLUE}{'='*70}{RESET}\n")
    
    print(f"Total Tests: {total_tests}")
    print(f"{GREEN}Passed: {passed_tests}{RESET}")
    print(f"{RED}Failed: {len(failed_tests)}{RESET}")
    print(f"Success Rate: {(passed_tests/total_tests*100):.1f}%\n")
    
    if failed_tests:
        print(f"{RED}Failed Tests:{RESET}")
        for i, test in enumerate(failed_tests, 1):
            print(f"  {i}. {test}")
        print()
        return 1
    else:
        print(f"{GREEN}✓ All tests passed!{RESET}\n")
        return 0

if __name__ == "__main__":
    sys.exit(main())
