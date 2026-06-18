#!/usr/bin/env python3
"""
Comprehensive backend API test suite for Nova AI Assistant
Tests all critical endpoints against production URL
"""

import requests
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

# Production API URL
BASE_URL = "https://ai-chat-mobile-64.preview.emergentagent.com/api"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

def print_test(name: str, passed: bool, details: str = ""):
    status = f"{Colors.GREEN}✓ PASS{Colors.END}" if passed else f"{Colors.RED}✗ FAIL{Colors.END}"
    print(f"{status} - {name}")
    if details:
        print(f"  {details}")
    if not passed:
        print()

def print_section(name: str):
    print(f"\n{Colors.BLUE}{'='*60}{Colors.END}")
    print(f"{Colors.BLUE}{name}{Colors.END}")
    print(f"{Colors.BLUE}{'='*60}{Colors.END}\n")

# Test data storage
test_data = {
    "session_id": None,
    "memory_id": None,
    "goal_id": None,
    "reminder_id": None,
    "notification_id": None,
}

def test_health_check():
    """Test 1: Health Check - GET /api/"""
    print_section("1. HEALTH CHECK")
    try:
        response = requests.get(f"{BASE_URL}/", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            has_message = "message" in data
            has_model = "model" in data
            model_name = data.get("model", "")
            
            passed = has_message and has_model
            details = f"Status: {response.status_code}, Model: {model_name}"
            print_test("Health check endpoint", passed, details)
            
            if "nova" in model_name.lower():
                print_test("Amazon Nova model configured", True, f"Model: {model_name}")
            else:
                print_test("Amazon Nova model configured", False, f"Expected Nova model, got: {model_name}")
        else:
            print_test("Health check endpoint", False, f"Status: {response.status_code}")
            
    except Exception as e:
        print_test("Health check endpoint", False, f"Error: {str(e)}")

def test_sessions_crud():
    """Test 2: Sessions CRUD operations"""
    print_section("2. SESSIONS CRUD")
    
    # Create session
    try:
        payload = {"title": "Test Chat Session"}
        response = requests.post(f"{BASE_URL}/sessions", json=payload, timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            test_data["session_id"] = data.get("id")
            has_id = "id" in data
            has_title = data.get("title") == "Test Chat Session"
            passed = has_id and has_title
            print_test("Create session", passed, f"Session ID: {test_data['session_id']}")
        else:
            print_test("Create session", False, f"Status: {response.status_code}, Response: {response.text[:200]}")
    except Exception as e:
        print_test("Create session", False, f"Error: {str(e)}")
    
    # List sessions
    try:
        response = requests.get(f"{BASE_URL}/sessions", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            is_list = isinstance(data, list)
            print_test("List sessions", is_list, f"Found {len(data)} sessions")
        else:
            print_test("List sessions", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List sessions", False, f"Error: {str(e)}")
    
    # List sessions with search
    try:
        response = requests.get(f"{BASE_URL}/sessions?search=Test", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            print_test("List sessions with search", True, f"Found {len(data)} matching sessions")
        else:
            print_test("List sessions with search", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List sessions with search", False, f"Error: {str(e)}")
    
    # Get messages for session
    if test_data["session_id"]:
        try:
            response = requests.get(f"{BASE_URL}/sessions/{test_data['session_id']}/messages", timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                is_list = isinstance(data, list)
                print_test("Get session messages", is_list, f"Found {len(data)} messages")
            else:
                print_test("Get session messages", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Get session messages", False, f"Error: {str(e)}")
    
    # Toggle pin
    if test_data["session_id"]:
        try:
            response = requests.post(f"{BASE_URL}/sessions/{test_data['session_id']}/pin", timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                is_pinned = data.get("pinned", False)
                print_test("Toggle pin session", True, f"Pinned: {is_pinned}")
            else:
                print_test("Toggle pin session", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Toggle pin session", False, f"Error: {str(e)}")

def test_chat_endpoint():
    """Test 3: Chat endpoint with AWS Bedrock"""
    print_section("3. CHAT ENDPOINT (AWS Bedrock)")
    
    if not test_data["session_id"]:
        # Create a session first
        try:
            payload = {"title": "Chat Test Session"}
            response = requests.post(f"{BASE_URL}/sessions", json=payload, timeout=10)
            if response.status_code == 200:
                test_data["session_id"] = response.json().get("id")
        except:
            pass
    
    if test_data["session_id"]:
        try:
            payload = {
                "session_id": test_data["session_id"],
                "message": "Hello Nova! Can you tell me what you are?"
            }
            response = requests.post(f"{BASE_URL}/chat", json=payload, timeout=30)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                has_session = "session_id" in data
                has_user_msg = "user_message" in data
                has_assistant_msg = "assistant_message" in data
                
                if has_assistant_msg:
                    assistant_content = data["assistant_message"].get("content", "")
                    has_response = len(assistant_content) > 0
                    
                    passed = has_session and has_user_msg and has_assistant_msg and has_response
                    print_test("Chat with AWS Bedrock", passed, 
                             f"Response length: {len(assistant_content)} chars")
                    
                    if has_response:
                        print(f"  {Colors.YELLOW}AI Response preview:{Colors.END} {assistant_content[:150]}...")
                else:
                    print_test("Chat with AWS Bedrock", False, "No assistant message in response")
            else:
                print_test("Chat with AWS Bedrock", False, 
                         f"Status: {response.status_code}, Response: {response.text[:300]}")
        except Exception as e:
            print_test("Chat with AWS Bedrock", False, f"Error: {str(e)}")
    else:
        print_test("Chat with AWS Bedrock", False, "No session ID available")

def test_memories_crud():
    """Test 4: Memories CRUD operations"""
    print_section("4. MEMORIES CRUD")
    
    # Create memory
    try:
        payload = {
            "category": "person",
            "subject": "John Doe",
            "content": "John is a software engineer who loves Python and AI",
            "importance": 4
        }
        response = requests.post(f"{BASE_URL}/memories", json=payload, timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            test_data["memory_id"] = data.get("id")
            has_id = "id" in data
            correct_subject = data.get("subject") == "John Doe"
            passed = has_id and correct_subject
            print_test("Create memory", passed, f"Memory ID: {test_data['memory_id']}")
        else:
            print_test("Create memory", False, f"Status: {response.status_code}, Response: {response.text[:200]}")
    except Exception as e:
        print_test("Create memory", False, f"Error: {str(e)}")
    
    # List all memories
    try:
        response = requests.get(f"{BASE_URL}/memories", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            is_list = isinstance(data, list)
            print_test("List all memories", is_list, f"Found {len(data)} memories")
        else:
            print_test("List all memories", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List all memories", False, f"Error: {str(e)}")
    
    # List memories by category
    try:
        response = requests.get(f"{BASE_URL}/memories?category=person", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            print_test("List memories by category", True, f"Found {len(data)} person memories")
        else:
            print_test("List memories by category", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List memories by category", False, f"Error: {str(e)}")
    
    # Search memories
    try:
        response = requests.get(f"{BASE_URL}/memories?search=John", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            print_test("Search memories", True, f"Found {len(data)} matching memories")
        else:
            print_test("Search memories", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("Search memories", False, f"Error: {str(e)}")
    
    # Delete memory
    if test_data["memory_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/memories/{test_data['memory_id']}", timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                print_test("Delete memory", data.get("ok") == True, "Memory deleted successfully")
            else:
                print_test("Delete memory", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Delete memory", False, f"Error: {str(e)}")

def test_goals_crud():
    """Test 5: Goals CRUD operations"""
    print_section("5. GOALS CRUD")
    
    # Create goal
    try:
        payload = {
            "title": "Learn AWS Bedrock",
            "description": "Master AWS Bedrock for AI applications",
            "target": "Complete by end of Q2 2024"
        }
        response = requests.post(f"{BASE_URL}/goals", json=payload, timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            test_data["goal_id"] = data.get("id")
            has_id = "id" in data
            correct_title = data.get("title") == "Learn AWS Bedrock"
            passed = has_id and correct_title
            print_test("Create goal", passed, f"Goal ID: {test_data['goal_id']}")
        else:
            print_test("Create goal", False, f"Status: {response.status_code}, Response: {response.text[:200]}")
    except Exception as e:
        print_test("Create goal", False, f"Error: {str(e)}")
    
    # List goals
    try:
        response = requests.get(f"{BASE_URL}/goals", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            is_list = isinstance(data, list)
            print_test("List goals", is_list, f"Found {len(data)} goals")
        else:
            print_test("List goals", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List goals", False, f"Error: {str(e)}")
    
    # Update goal
    if test_data["goal_id"]:
        try:
            payload = {
                "progress": 50,
                "status": "active"
            }
            response = requests.put(f"{BASE_URL}/goals/{test_data['goal_id']}", json=payload, timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                correct_progress = data.get("progress") == 50
                print_test("Update goal", correct_progress, f"Progress updated to 50%")
            else:
                print_test("Update goal", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Update goal", False, f"Error: {str(e)}")
    
    # Delete goal
    if test_data["goal_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/goals/{test_data['goal_id']}", timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                print_test("Delete goal", data.get("ok") == True, "Goal deleted successfully")
            else:
                print_test("Delete goal", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Delete goal", False, f"Error: {str(e)}")

def test_reminders_crud():
    """Test 6: Reminders CRUD operations"""
    print_section("6. REMINDERS CRUD")
    
    # Create reminder
    try:
        payload = {
            "text": "Review AWS Bedrock documentation",
            "condition": "Before next team meeting"
        }
        response = requests.post(f"{BASE_URL}/reminders", json=payload, timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            test_data["reminder_id"] = data.get("id")
            has_id = "id" in data
            correct_text = "AWS Bedrock" in data.get("text", "")
            passed = has_id and correct_text
            print_test("Create reminder", passed, f"Reminder ID: {test_data['reminder_id']}")
        else:
            print_test("Create reminder", False, f"Status: {response.status_code}, Response: {response.text[:200]}")
    except Exception as e:
        print_test("Create reminder", False, f"Error: {str(e)}")
    
    # List all reminders
    try:
        response = requests.get(f"{BASE_URL}/reminders", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            is_list = isinstance(data, list)
            print_test("List all reminders", is_list, f"Found {len(data)} reminders")
        else:
            print_test("List all reminders", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List all reminders", False, f"Error: {str(e)}")
    
    # List reminders by status
    try:
        response = requests.get(f"{BASE_URL}/reminders?status=pending", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            print_test("List reminders by status", True, f"Found {len(data)} pending reminders")
        else:
            print_test("List reminders by status", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List reminders by status", False, f"Error: {str(e)}")
    
    # Update reminder
    if test_data["reminder_id"]:
        try:
            payload = {
                "status": "done"
            }
            response = requests.put(f"{BASE_URL}/reminders/{test_data['reminder_id']}", json=payload, timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                correct_status = data.get("status") == "done"
                print_test("Update reminder", correct_status, "Status updated to 'done'")
            else:
                print_test("Update reminder", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Update reminder", False, f"Error: {str(e)}")
    
    # Delete reminder
    if test_data["reminder_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/reminders/{test_data['reminder_id']}", timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                print_test("Delete reminder", data.get("ok") == True, "Reminder deleted successfully")
            else:
                print_test("Delete reminder", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Delete reminder", False, f"Error: {str(e)}")

def test_daily_briefing():
    """Test 7: Daily Briefing endpoint"""
    print_section("7. DAILY BRIEFING")
    
    try:
        # Test without location
        response = requests.get(f"{BASE_URL}/briefing", timeout=15)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            has_greeting = "greeting" in data
            has_reminders = "pending_reminders" in data
            has_goals = "active_goals" in data
            has_integrations = "integrations" in data
            
            passed = has_greeting and has_reminders and has_goals and has_integrations
            print_test("Daily briefing (no location)", passed, 
                     f"Greeting: {data.get('greeting', 'N/A')}")
            
            if has_integrations:
                integrations = data.get("integrations", {})
                google_cal = integrations.get("google_calendar", {})
                gmail = integrations.get("gmail", {})
                print_test("Briefing includes integrations", True, 
                         f"Google Calendar: {google_cal.get('connected', False)}, Gmail: {gmail.get('connected', False)}")
        else:
            print_test("Daily briefing (no location)", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("Daily briefing (no location)", False, f"Error: {str(e)}")
    
    # Test with location (San Francisco coordinates)
    try:
        response = requests.get(f"{BASE_URL}/briefing?lat=37.7749&lon=-122.4194&tz_offset=-480", timeout=15)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            has_weather = data.get("weather") is not None
            if has_weather:
                weather = data.get("weather", {})
                print_test("Daily briefing with weather", True, 
                         f"Temp: {weather.get('temperature_c')}°C, {weather.get('summary')}")
            else:
                print_test("Daily briefing with weather", True, "Weather data not available (API may be down)")
        else:
            print_test("Daily briefing with weather", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("Daily briefing with weather", False, f"Error: {str(e)}")

def test_google_integration():
    """Test 8: Google Integration endpoints"""
    print_section("8. GOOGLE INTEGRATION")
    
    # Check Google status
    try:
        response = requests.get(f"{BASE_URL}/google/status", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            is_connected = data.get("connected", False)
            email = data.get("email", "Not connected")
            print_test("Google connection status", True, 
                     f"Connected: {is_connected}, Email: {email}")
            
            # Store connection status for later tests
            test_data["google_connected"] = is_connected
        else:
            print_test("Google connection status", False, f"Status: {response.status_code}")
            test_data["google_connected"] = False
    except Exception as e:
        print_test("Google connection status", False, f"Error: {str(e)}")
        test_data["google_connected"] = False
    
    # Get auth URL
    try:
        response = requests.get(f"{BASE_URL}/google/auth-url", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            has_url = "url" in data and data["url"].startswith("https://accounts.google.com")
            print_test("Google auth URL", has_url, "OAuth URL generated successfully")
        else:
            print_test("Google auth URL", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("Google auth URL", False, f"Error: {str(e)}")
    
    # Test Calendar endpoints (only if connected)
    if test_data.get("google_connected"):
        try:
            response = requests.get(f"{BASE_URL}/calendar/upcoming?limit=5", timeout=15)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                events = data.get("events", [])
                print_test("Google Calendar - upcoming events", True, 
                         f"Found {len(events)} upcoming events")
            else:
                print_test("Google Calendar - upcoming events", False, 
                         f"Status: {response.status_code}, Response: {response.text[:200]}")
        except Exception as e:
            print_test("Google Calendar - upcoming events", False, f"Error: {str(e)}")
        
        # Test Gmail endpoints
        try:
            response = requests.get(f"{BASE_URL}/gmail/recent?limit=5", timeout=15)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                messages = data.get("messages", [])
                print_test("Gmail - recent emails", True, 
                         f"Found {len(messages)} recent emails")
            else:
                print_test("Gmail - recent emails", False, 
                         f"Status: {response.status_code}, Response: {response.text[:200]}")
        except Exception as e:
            print_test("Gmail - recent emails", False, f"Error: {str(e)}")
    else:
        print(f"  {Colors.YELLOW}⊘ Skipping Calendar/Gmail tests - Google not connected{Colors.END}")

def test_notifications():
    """Test 9: Notifications endpoints"""
    print_section("9. NOTIFICATIONS")
    
    # Ingest notification
    try:
        payload = {
            "package_name": "com.phonepe.app",
            "title": "Payment Received",
            "text": "You received ₹500 from John Doe",
            "posted_at": datetime.now(timezone.utc).isoformat()
        }
        response = requests.post(f"{BASE_URL}/notifications/ingest", json=payload, timeout=15)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            test_data["notification_id"] = data.get("id")
            has_id = "id" in data
            has_kind = "kind" in data
            kind = data.get("kind", "unknown")
            
            passed = has_id and has_kind
            print_test("Ingest notification", passed, 
                     f"Notification ID: {test_data['notification_id']}, Kind: {kind}")
            
            # Check if transaction was detected
            if kind == "transaction":
                amount = data.get("amount")
                currency = data.get("currency")
                direction = data.get("direction")
                print_test("Transaction detection", True, 
                         f"Amount: {amount} {currency}, Direction: {direction}")
        else:
            print_test("Ingest notification", False, 
                     f"Status: {response.status_code}, Response: {response.text[:200]}")
    except Exception as e:
        print_test("Ingest notification", False, f"Error: {str(e)}")
    
    # List notifications
    try:
        response = requests.get(f"{BASE_URL}/notifications?limit=10", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            is_list = isinstance(data, list)
            print_test("List notifications", is_list, f"Found {len(data)} notifications")
        else:
            print_test("List notifications", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List notifications", False, f"Error: {str(e)}")
    
    # List notifications by kind
    try:
        response = requests.get(f"{BASE_URL}/notifications?kind=transaction&limit=10", timeout=10)
        passed = response.status_code == 200
        
        if passed:
            data = response.json()
            print_test("List notifications by kind", True, 
                     f"Found {len(data)} transaction notifications")
        else:
            print_test("List notifications by kind", False, f"Status: {response.status_code}")
    except Exception as e:
        print_test("List notifications by kind", False, f"Error: {str(e)}")
    
    # Delete notification
    if test_data["notification_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/notifications/{test_data['notification_id']}", timeout=10)
            passed = response.status_code == 200
            
            if passed:
                data = response.json()
                print_test("Delete notification", data.get("ok") == True, "Notification deleted successfully")
            else:
                print_test("Delete notification", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Delete notification", False, f"Error: {str(e)}")

def cleanup_test_data():
    """Clean up test data created during testing"""
    print_section("CLEANUP")
    
    # Delete test session
    if test_data["session_id"]:
        try:
            response = requests.delete(f"{BASE_URL}/sessions/{test_data['session_id']}", timeout=10)
            if response.status_code == 200:
                print_test("Cleanup test session", True, f"Session {test_data['session_id']} deleted")
            else:
                print_test("Cleanup test session", False, f"Status: {response.status_code}")
        except Exception as e:
            print_test("Cleanup test session", False, f"Error: {str(e)}")

def main():
    print(f"\n{Colors.BLUE}{'='*60}{Colors.END}")
    print(f"{Colors.BLUE}Nova AI Assistant - Backend API Test Suite{Colors.END}")
    print(f"{Colors.BLUE}Testing URL: {BASE_URL}{Colors.END}")
    print(f"{Colors.BLUE}{'='*60}{Colors.END}")
    
    # Run all tests
    test_health_check()
    test_sessions_crud()
    test_chat_endpoint()
    test_memories_crud()
    test_goals_crud()
    test_reminders_crud()
    test_daily_briefing()
    test_google_integration()
    test_notifications()
    
    # Cleanup
    cleanup_test_data()
    
    print(f"\n{Colors.BLUE}{'='*60}{Colors.END}")
    print(f"{Colors.BLUE}Testing Complete{Colors.END}")
    print(f"{Colors.BLUE}{'='*60}{Colors.END}\n")

if __name__ == "__main__":
    main()
