"""
Tool Calling Framework for Nova AI Assistant
Enables AI to call tools like calculator, weather, search, calendar, etc.
"""
import re
import json
import math
import httpx
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Callable
import logging

logger = logging.getLogger(__name__)

# ==================== TOOL DEFINITIONS ====================

TOOLS_SCHEMA = [
    {
        "name": "calculator",
        "description": "Perform mathematical calculations. Use for any math operations.",
        "parameters": {
            "expression": "Mathematical expression to evaluate (e.g., '2 + 2', 'sqrt(16)', '15% of 200')"
        }
    },
    {
        "name": "get_weather",
        "description": "Get current weather for a location.",
        "parameters": {
            "location": "City name or 'lat,lon' coordinates"
        }
    },
    {
        "name": "web_search",
        "description": "Search the web for current information, news, facts, or anything not in your knowledge.",
        "parameters": {
            "query": "Search query"
        }
    },
    {
        "name": "search_knowledge",
        "description": "Search user's uploaded documents and knowledge vault.",
        "parameters": {
            "query": "Search query for documents"
        }
    },
    {
        "name": "create_reminder",
        "description": "Create a reminder for the user.",
        "parameters": {
            "text": "What to remind about",
            "condition": "When to remind (optional, e.g., 'tomorrow', 'after meeting')"
        }
    },
    {
        "name": "create_goal",
        "description": "Create a new goal for the user to track.",
        "parameters": {
            "title": "Goal title",
            "target": "Target date or milestone (optional)",
            "description": "Goal description (optional)"
        }
    },
    {
        "name": "get_calendar_events",
        "description": "Get upcoming calendar events.",
        "parameters": {
            "days": "Number of days to look ahead (default 7)"
        }
    },
    {
        "name": "create_calendar_event",
        "description": "Create a new calendar event.",
        "parameters": {
            "title": "Event title",
            "start_time": "Start time in natural language (e.g., 'tomorrow at 3pm', '2024-06-20 14:00')",
            "duration_minutes": "Duration in minutes (default 30)",
            "description": "Event description (optional)"
        }
    },
    {
        "name": "send_email",
        "description": "Send an email via Gmail.",
        "parameters": {
            "to": "Recipient email address",
            "subject": "Email subject",
            "body": "Email body text"
        }
    },
    {
        "name": "get_spending_summary",
        "description": "Get spending summary from banking notifications.",
        "parameters": {
            "days": "Number of days to analyze (default 30)"
        }
    }
]

# Format tools for AI prompt
def get_tools_prompt() -> str:
    """Generate tools description for AI system prompt."""
    lines = ["You have access to the following tools. To use a tool, respond with a JSON block:\n```tool\n{\"tool\": \"tool_name\", \"params\": {...}}\n```\n\nAvailable tools:"]
    for tool in TOOLS_SCHEMA:
        params = ", ".join([f"{k}: {v}" for k, v in tool["parameters"].items()])
        lines.append(f"\n• {tool['name']}: {tool['description']}\n  Parameters: {params}")
    lines.append("\n\nOnly use tools when necessary. For simple questions, respond directly.")
    return "\n".join(lines)


# ==================== TOOL IMPLEMENTATIONS ====================

async def tool_calculator(expression: str) -> Dict[str, Any]:
    """Safe math expression evaluator."""
    try:
        # Clean expression
        expr = expression.lower().strip()
        
        # Handle percentage calculations
        percent_match = re.search(r'(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)', expr)
        if percent_match:
            pct, num = float(percent_match.group(1)), float(percent_match.group(2))
            result = (pct / 100) * num
            return {"success": True, "result": result, "expression": expression}
        
        # Replace common math terms
        expr = expr.replace('^', '**')
        expr = re.sub(r'sqrt\s*\(', 'math.sqrt(', expr)
        expr = re.sub(r'sin\s*\(', 'math.sin(', expr)
        expr = re.sub(r'cos\s*\(', 'math.cos(', expr)
        expr = re.sub(r'tan\s*\(', 'math.tan(', expr)
        expr = re.sub(r'log\s*\(', 'math.log10(', expr)
        expr = re.sub(r'ln\s*\(', 'math.log(', expr)
        expr = expr.replace('pi', str(math.pi))
        expr = expr.replace('e', str(math.e))
        
        # Only allow safe characters
        if not re.match(r'^[\d\s\+\-\*\/\.\(\)math\.sqrtsincogtanlogpi]+$', expr.replace(' ', '')):
            return {"success": False, "error": "Invalid expression"}
        
        result = eval(expr, {"__builtins__": {}, "math": math})
        return {"success": True, "result": round(result, 6) if isinstance(result, float) else result, "expression": expression}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_weather(location: str) -> Dict[str, Any]:
    """Get weather using Open-Meteo API (free, no key needed)."""
    try:
        # First geocode the location
        async with httpx.AsyncClient(timeout=10.0) as http:
            geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={location}&count=1"
            geo_resp = await http.get(geo_url)
            if geo_resp.status_code != 200:
                return {"success": False, "error": "Could not find location"}
            
            geo_data = geo_resp.json()
            if not geo_data.get("results"):
                return {"success": False, "error": f"Location '{location}' not found"}
            
            place = geo_data["results"][0]
            lat, lon = place["latitude"], place["longitude"]
            
            # Get weather
            weather_url = (
                f"https://api.open-meteo.com/v1/forecast"
                f"?latitude={lat}&longitude={lon}"
                "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m"
                "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max"
                "&timezone=auto&forecast_days=3"
            )
            weather_resp = await http.get(weather_url)
            if weather_resp.status_code != 200:
                return {"success": False, "error": "Weather API error"}
            
            data = weather_resp.json()
            current = data.get("current", {})
            daily = data.get("daily", {})
            
            weather_codes = {
                0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
                45: "Foggy", 48: "Foggy", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
                61: "Light rain", 63: "Rain", 65: "Heavy rain",
                71: "Light snow", 73: "Snow", 75: "Heavy snow",
                80: "Showers", 81: "Showers", 82: "Heavy showers",
                95: "Thunderstorm", 96: "Thunderstorm with hail"
            }
            
            return {
                "success": True,
                "location": f"{place['name']}, {place.get('country', '')}",
                "current": {
                    "temperature_c": current.get("temperature_2m"),
                    "humidity": current.get("relative_humidity_2m"),
                    "wind_kph": current.get("wind_speed_10m"),
                    "condition": weather_codes.get(current.get("weather_code", 0), "Unknown")
                },
                "forecast": [
                    {
                        "date": daily["time"][i] if daily.get("time") else None,
                        "high_c": daily["temperature_2m_max"][i] if daily.get("temperature_2m_max") else None,
                        "low_c": daily["temperature_2m_min"][i] if daily.get("temperature_2m_min") else None,
                        "precipitation_chance": daily["precipitation_probability_max"][i] if daily.get("precipitation_probability_max") else None
                    }
                    for i in range(min(3, len(daily.get("time", []))))
                ]
            }
    except Exception as e:
        logger.exception("Weather tool error")
        return {"success": False, "error": str(e)}


async def tool_web_search(query: str) -> Dict[str, Any]:
    """Search the web using Wikipedia API (free, no API key)."""
    try:
        encoded_query = urllib.parse.quote_plus(query)
        
        headers = {
            "User-Agent": "NovaAI/1.0 (https://nova.ai; contact@nova.ai) Python/3.11"
        }
        
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as http:
            results = []
            
            # Try DuckDuckGo Instant Answer API first
            try:
                ddg_url = f"https://api.duckduckgo.com/?q={encoded_query}&format=json&no_html=1&skip_disambig=1"
                resp = await http.get(ddg_url)
                
                if resp.status_code == 200:
                    data = resp.json()
                    
                    # Get abstract/instant answer
                    if data.get("Abstract"):
                        results.append({
                            "title": data.get("Heading", "Answer"),
                            "snippet": data["Abstract"],
                            "source": data.get("AbstractSource", "DuckDuckGo"),
                            "url": data.get("AbstractURL", "")
                        })
                    
                    # Get related topics
                    for topic in data.get("RelatedTopics", [])[:5]:
                        if isinstance(topic, dict) and topic.get("Text"):
                            results.append({
                                "title": topic.get("Text", "")[:100],
                                "snippet": topic.get("Text", ""),
                                "url": topic.get("FirstURL", "")
                            })
            except Exception as e:
                logger.warning(f"DuckDuckGo API failed: {e}")
            
            # Always try Wikipedia API as fallback/supplement
            if len(results) < 3:
                try:
                    wiki_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={encoded_query}&format=json&srlimit=5"
                    wiki_resp = await http.get(wiki_url)
                    
                    if wiki_resp.status_code == 200:
                        wiki_data = wiki_resp.json()
                        for item in wiki_data.get("query", {}).get("search", [])[:5]:
                            # Clean HTML from snippet
                            snippet = re.sub(r'<[^>]+>', '', item.get("snippet", ""))
                            results.append({
                                "title": item.get("title", ""),
                                "snippet": snippet,
                                "source": "Wikipedia",
                                "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(item.get('title', ''))}"
                            })
                except Exception as e:
                    logger.warning(f"Wikipedia search failed: {e}")
            
            if not results:
                return {"success": True, "results": [], "message": "No results found. Try rephrasing your search."}
            
            return {"success": True, "query": query, "results": results[:5]}
    except Exception as e:
        logger.exception("Web search error")
        return {"success": False, "error": str(e)}


async def tool_search_knowledge(query: str, db) -> Dict[str, Any]:
    """Search user's knowledge vault documents."""
    try:
        # Search documents using text search
        # MongoDB text search on content field
        results = await db.knowledge_docs.find(
            {"$text": {"$search": query}},
            {"score": {"$meta": "textScore"}, "_id": 0}
        ).sort([("score", {"$meta": "textScore"})]).limit(5).to_list(5)
        
        if not results:
            # Fallback to regex search
            regex = {"$regex": query, "$options": "i"}
            results = await db.knowledge_docs.find(
                {"$or": [{"content": regex}, {"title": regex}, {"chunks.text": regex}]},
                {"_id": 0}
            ).limit(5).to_list(5)
        
        if not results:
            return {"success": True, "results": [], "message": "No matching documents found in knowledge vault."}
        
        formatted = []
        for doc in results:
            formatted.append({
                "title": doc.get("title", "Untitled"),
                "type": doc.get("file_type", "unknown"),
                "excerpt": doc.get("content", "")[:500] + "..." if len(doc.get("content", "")) > 500 else doc.get("content", ""),
                "uploaded_at": doc.get("created_at", "")
            })
        
        return {"success": True, "query": query, "results": formatted}
    except Exception as e:
        logger.exception("Knowledge search error")
        return {"success": False, "error": str(e)}


async def tool_create_reminder(text: str, condition: str, db) -> Dict[str, Any]:
    """Create a reminder in the database."""
    try:
        reminder = {
            "id": str(__import__('uuid').uuid4()),
            "text": text[:300],
            "condition": condition[:300] if condition else "",
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        await db.reminders.insert_one(reminder)
        return {"success": True, "reminder": reminder, "message": f"Reminder created: {text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_create_goal(title: str, target: str, description: str, db) -> Dict[str, Any]:
    """Create a goal in the database."""
    try:
        goal = {
            "id": str(__import__('uuid').uuid4()),
            "title": title[:120],
            "description": description[:600] if description else "",
            "target": target[:200] if target else "",
            "progress": 0,
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        await db.goals.insert_one(goal)
        return {"success": True, "goal": goal, "message": f"Goal created: {title}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_calendar_events(days: int, google_helper, db) -> Dict[str, Any]:
    """Get upcoming calendar events from Google Calendar."""
    try:
        token = await google_helper.get_valid_token(db)
        if not token:
            return {"success": False, "error": "Google Calendar not connected. Please connect in Daily Briefing."}
        
        events = await google_helper.list_upcoming_events(token, max_results=min(days * 2, 20))
        
        formatted = []
        for ev in events:
            formatted.append({
                "title": ev.get("summary", "Untitled"),
                "start": ev.get("start"),
                "end": ev.get("end"),
                "location": ev.get("location", "")
            })
        
        return {"success": True, "events": formatted, "count": len(formatted)}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_create_calendar_event(title: str, start_time: str, duration_minutes: int, description: str, google_helper, db) -> Dict[str, Any]:
    """Create a calendar event in Google Calendar."""
    try:
        token = await google_helper.get_valid_token(db)
        if not token:
            return {"success": False, "error": "Google Calendar not connected."}
        
        # Parse natural language time (simplified - in production use dateparser)
        from datetime import timedelta
        import re
        
        now = datetime.now(timezone.utc)
        
        # Simple time parsing
        if "tomorrow" in start_time.lower():
            start_dt = now + timedelta(days=1)
            time_match = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)?', start_time.lower())
            if time_match:
                hour = int(time_match.group(1))
                minute = int(time_match.group(2) or 0)
                if time_match.group(3) == 'pm' and hour < 12:
                    hour += 12
                start_dt = start_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
        else:
            # Try to parse ISO format
            try:
                start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
            except:
                # Default to 1 hour from now
                start_dt = now + timedelta(hours=1)
        
        end_dt = start_dt + timedelta(minutes=duration_minutes or 30)
        
        event = await google_helper.create_event(
            token,
            title,
            start_dt.isoformat(),
            end_dt.isoformat(),
            description or ""
        )
        
        return {
            "success": True,
            "event": {
                "title": event.get("summary"),
                "start": event.get("start", {}).get("dateTime"),
                "end": event.get("end", {}).get("dateTime"),
                "link": event.get("htmlLink")
            },
            "message": f"Event '{title}' created successfully!"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_send_email(to: str, subject: str, body: str, google_helper, db) -> Dict[str, Any]:
    """Send an email via Gmail."""
    try:
        token = await google_helper.get_valid_token(db)
        if not token:
            return {"success": False, "error": "Gmail not connected."}
        
        result = await google_helper.send_email(token, to, subject, body)
        return {"success": True, "message": f"Email sent to {to}", "subject": subject}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def tool_get_spending_summary(days: int, db) -> Dict[str, Any]:
    """Get spending summary from banking notifications."""
    try:
        from datetime import timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        
        transactions = await db.notifications.find({
            "kind": "transaction",
            "posted_at": {"$gte": cutoff}
        }, {"_id": 0}).to_list(500)
        
        if not transactions:
            return {"success": True, "message": "No transactions found in the specified period.", "summary": {}}
        
        total_debit = 0
        total_credit = 0
        by_merchant: Dict[str, float] = {}
        
        for tx in transactions:
            amount = tx.get("amount") or 0
            direction = tx.get("direction", "").lower()
            merchant = tx.get("merchant", "Unknown")
            
            if direction == "debit":
                total_debit += amount
                by_merchant[merchant] = by_merchant.get(merchant, 0) + amount
            elif direction == "credit":
                total_credit += amount
        
        # Top spending categories
        top_merchants = sorted(by_merchant.items(), key=lambda x: x[1], reverse=True)[:5]
        
        return {
            "success": True,
            "period_days": days,
            "summary": {
                "total_spent": round(total_debit, 2),
                "total_received": round(total_credit, 2),
                "net": round(total_credit - total_debit, 2),
                "transaction_count": len(transactions),
                "top_merchants": [{"name": m, "amount": round(a, 2)} for m, a in top_merchants]
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ==================== TOOL EXECUTOR ====================

async def execute_tool(tool_name: str, params: Dict[str, Any], db, google_helper=None) -> Dict[str, Any]:
    """Execute a tool by name with given parameters."""
    tool_map = {
        "calculator": lambda p: tool_calculator(p.get("expression", "")),
        "get_weather": lambda p: tool_get_weather(p.get("location", "")),
        "web_search": lambda p: tool_web_search(p.get("query", "")),
        "search_knowledge": lambda p: tool_search_knowledge(p.get("query", ""), db),
        "create_reminder": lambda p: tool_create_reminder(p.get("text", ""), p.get("condition", ""), db),
        "create_goal": lambda p: tool_create_goal(p.get("title", ""), p.get("target", ""), p.get("description", ""), db),
        "get_calendar_events": lambda p: tool_get_calendar_events(int(p.get("days", 7)), google_helper, db),
        "create_calendar_event": lambda p: tool_create_calendar_event(
            p.get("title", ""), p.get("start_time", ""), int(p.get("duration_minutes", 30)), p.get("description", ""), google_helper, db
        ),
        "send_email": lambda p: tool_send_email(p.get("to", ""), p.get("subject", ""), p.get("body", ""), google_helper, db),
        "get_spending_summary": lambda p: tool_get_spending_summary(int(p.get("days", 30)), db),
    }
    
    if tool_name not in tool_map:
        return {"success": False, "error": f"Unknown tool: {tool_name}"}
    
    try:
        result = await tool_map[tool_name](params)
        return result
    except Exception as e:
        logger.exception(f"Tool execution error for {tool_name}")
        return {"success": False, "error": str(e)}


def extract_tool_call(text: str) -> Optional[Dict[str, Any]]:
    """Extract tool call from AI response."""
    # Look for ```tool ... ``` block
    match = re.search(r'```tool\s*\n?(\{.*?\})\s*\n?```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    
    # Also try inline JSON with "tool" key
    match = re.search(r'\{[^{}]*"tool"\s*:\s*"[^"]+\"[^{}]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    
    return None
