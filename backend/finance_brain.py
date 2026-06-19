"""
Personal Finance Brain for Nova AI Assistant
Analyzes banking notifications, categorizes spending, provides insights.
"""
import re
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger(__name__)

# ==================== SPENDING CATEGORIES ====================

CATEGORY_PATTERNS = {
    "food": [
        r"swiggy", r"zomato", r"uber\s*eats", r"dominos", r"pizza", r"restaurant",
        r"cafe", r"coffee", r"starbucks", r"mcdonald", r"kfc", r"subway",
        r"food", r"dining", r"eat", r"meal", r"lunch", r"dinner", r"breakfast"
    ],
    "fuel": [
        r"petrol", r"diesel", r"fuel", r"hp\s*petroleum", r"indian\s*oil", r"bharat\s*petroleum",
        r"bpcl", r"iocl", r"hpcl", r"gas\s*station", r"shell", r"reliance\s*petroleum"
    ],
    "shopping": [
        r"amazon", r"flipkart", r"myntra", r"ajio", r"nykaa", r"meesho",
        r"shopping", r"mart", r"store", r"retail", r"mall", r"dmart", r"big\s*bazaar"
    ],
    "transport": [
        r"uber", r"ola", r"rapido", r"metro", r"irctc", r"railway", r"bus",
        r"cab", r"taxi", r"auto", r"rickshaw", r"flight", r"airline"
    ],
    "utilities": [
        r"electricity", r"water\s*bill", r"gas\s*bill", r"internet", r"broadband",
        r"jio", r"airtel", r"vodafone", r"vi\s*", r"bsnl", r"act\s*fibernet",
        r"mobile\s*recharge", r"dth", r"tata\s*sky", r"dish\s*tv"
    ],
    "entertainment": [
        r"netflix", r"prime\s*video", r"hotstar", r"spotify", r"youtube\s*premium",
        r"movie", r"pvr", r"inox", r"cinema", r"gaming", r"playstation", r"xbox"
    ],
    "health": [
        r"pharmacy", r"medical", r"hospital", r"clinic", r"doctor", r"apollo",
        r"medplus", r"netmeds", r"1mg", r"pharmeasy", r"gym", r"fitness"
    ],
    "education": [
        r"course", r"udemy", r"coursera", r"school", r"college", r"tuition",
        r"book", r"education", r"training", r"certification"
    ],
    "investment": [
        r"mutual\s*fund", r"sip", r"zerodha", r"groww", r"upstox", r"stock",
        r"share", r"trading", r"investment", r"fd", r"fixed\s*deposit", r"ppf", r"nps"
    ],
    "insurance": [
        r"lic", r"insurance", r"policy", r"premium", r"hdfc\s*life", r"icici\s*prudential",
        r"max\s*life", r"term\s*plan", r"health\s*insurance"
    ],
    "rent": [
        r"rent", r"housing", r"apartment", r"flat", r"pg", r"hostel", r"accommodation"
    ],
    "subscription": [
        r"subscription", r"membership", r"annual", r"monthly\s*plan"
    ],
    "transfer": [
        r"transfer", r"sent\s*to", r"paid\s*to", r"upi", r"neft", r"imps", r"rtgs"
    ]
}

# Bank patterns for parsing
BANK_PATTERNS = {
    "hdfc": r"hdfc|hdfcbank",
    "icici": r"icici|icicibank",
    "sbi": r"sbi|statebank",
    "axis": r"axis|axisbank",
    "kotak": r"kotak|kotakbank",
    "paytm": r"paytm",
    "phonepe": r"phonepe",
    "gpay": r"googlepay|gpay|google\s*pay"
}


def categorize_transaction(merchant: str, description: str = "") -> str:
    """Categorize a transaction based on merchant name and description."""
    text = f"{merchant} {description}".lower()
    
    for category, patterns in CATEGORY_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return category
    
    return "other"


def parse_amount_from_text(text: str) -> Optional[float]:
    """Extract amount from notification text."""
    # Patterns for Indian Rupee amounts
    patterns = [
        r"(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)",  # Rs. 1,234.56 or ₹1234
        r"([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)",  # 1234 Rs or 1234 INR
        r"debited.*?([\d,]+(?:\.\d{1,2})?)",           # debited 1234
        r"credited.*?([\d,]+(?:\.\d{1,2})?)",          # credited 1234
        r"amount.*?([\d,]+(?:\.\d{1,2})?)",            # amount: 1234
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            amount_str = match.group(1).replace(",", "")
            try:
                return float(amount_str)
            except ValueError:
                continue
    
    return None


def parse_upi_id(text: str) -> Optional[str]:
    """Extract UPI ID from text."""
    match = re.search(r"([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)", text)
    return match.group(1) if match else None


def detect_transaction_direction(text: str) -> str:
    """Detect if transaction is debit (outgoing) or credit (incoming)."""
    text_lower = text.lower()

    # Strong debit indicators - these win over "credit card" mentions
    strong_debit = [
        "debited", "you spent", "you paid", "card was used", "card used",
        "withdrawn", "purchase of", "transferred to", "sent to", "transaction of",
        "was used for",
    ]
    for kw in strong_debit:
        if kw in text_lower:
            return "debit"

    debit_keywords = ["debit", "spent", "paid", "purchase", "sent"]
    credit_keywords = ["credited", "received from", "received rs", "received ₹", "received inr",
                        "you received", "deposited", "refund", "cashback", "credited to"]

    for keyword in credit_keywords:
        if keyword in text_lower:
            return "credit"
    for keyword in debit_keywords:
        if keyword in text_lower:
            return "debit"

    return "unknown"


# ==================== FINANCE ANALYZER ====================

class PersonalFinanceBrain:
    """Analyzes personal finances from notifications and provides insights."""
    
    def __init__(self, db):
        self.db = db
    
    async def process_notification(self, title: str, text: str, app_name: str = "") -> Dict[str, Any]:
        """Process a banking notification and extract transaction data."""
        full_text = f"{title} {text}".lower()
        
        # Check if this is a financial notification
        financial_keywords = ["debited", "credited", "rs", "inr", "₹", "upi", "transfer", "payment"]
        is_financial = any(kw in full_text for kw in financial_keywords)
        
        if not is_financial:
            return {"is_transaction": False}
        
        # Parse transaction details
        amount = parse_amount_from_text(full_text)
        direction = detect_transaction_direction(full_text)
        upi_id = parse_upi_id(full_text)
        
        # Extract merchant/recipient
        merchant = self._extract_merchant(full_text, upi_id)
        
        # Categorize
        category = categorize_transaction(merchant, text)
        
        # Detect bank/app
        source = self._detect_source(app_name, full_text)
        
        transaction = {
            "id": str(uuid.uuid4()),
            "amount": amount,
            "direction": direction,
            "category": category,
            "merchant": merchant,
            "upi_id": upi_id,
            "source": source,
            "currency": "INR",
            "raw_text": text[:500],
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "kind": "transaction"
        }
        
        # Store in database
        await self.db.notifications.insert_one(transaction)
        
        # Remove _id for response
        transaction_copy = {k: v for k, v in transaction.items() if k != "_id"}
        
        return {"is_transaction": True, "transaction": transaction_copy}
    
    def _extract_merchant(self, text: str, upi_id: Optional[str]) -> str:
        """Extract merchant name from text."""
        # Try to extract from UPI ID
        if upi_id:
            parts = upi_id.split("@")
            if parts:
                return parts[0].replace(".", " ").title()
        
        # Look for "to" or "at" patterns
        patterns = [
            r"(?:to|at|from)\s+([A-Za-z0-9\s]+?)(?:\s+(?:on|for|via|upi|ref)|\d|$)",
            r"(?:paid|sent|received)\s+(?:to|from)\s+([A-Za-z0-9\s]+)",
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                merchant = match.group(1).strip()
                if len(merchant) > 2:
                    return merchant.title()
        
        return "Unknown"
    
    def _detect_source(self, app_name: str, text: str) -> str:
        """Detect the bank or payment app."""
        combined = f"{app_name} {text}".lower()
        
        for bank, pattern in BANK_PATTERNS.items():
            if re.search(pattern, combined, re.IGNORECASE):
                return bank.upper()
        
        return "BANK"
    
    async def get_spending_summary(self, days: int = 30) -> Dict[str, Any]:
        """Get comprehensive spending summary."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        
        transactions = await self.db.notifications.find({
            "kind": "transaction",
            "posted_at": {"$gte": cutoff}
        }, {"_id": 0}).to_list(1000)
        
        if not transactions:
            return {
                "has_data": False,
                "message": "No transaction data. Bank notifications will be analyzed automatically."
            }
        
        # Calculate totals
        total_spent = 0
        total_received = 0
        by_category: Dict[str, float] = defaultdict(float)
        by_merchant: Dict[str, float] = defaultdict(float)
        by_day: Dict[str, Dict[str, float]] = defaultdict(lambda: {"spent": 0, "received": 0})
        transaction_count = 0
        
        for tx in transactions:
            amount = tx.get("amount") or 0
            direction = (tx.get("direction") or "").lower()
            category = tx.get("category", "other")
            merchant = tx.get("merchant", "Unknown")
            
            try:
                day = tx.get("posted_at", "")[:10]
            except:
                day = "unknown"
            
            if direction == "debit":
                total_spent += amount
                by_category[category] += amount
                by_merchant[merchant] += amount
                by_day[day]["spent"] += amount
                transaction_count += 1
            elif direction == "credit":
                total_received += amount
                by_day[day]["received"] += amount
        
        # Sort categories and merchants by amount
        top_categories = sorted(by_category.items(), key=lambda x: x[1], reverse=True)[:10]
        top_merchants = sorted(by_merchant.items(), key=lambda x: x[1], reverse=True)[:10]
        
        # Daily trend
        daily_trend = []
        for i in range(min(days, 30)):
            day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
            daily_trend.append({
                "date": day,
                "spent": round(by_day[day]["spent"], 2),
                "received": round(by_day[day]["received"], 2)
            })
        daily_trend.reverse()
        
        # Calculate averages
        days_with_spending = len([d for d in by_day.values() if d["spent"] > 0])
        avg_daily_spend = total_spent / max(days_with_spending, 1)
        
        return {
            "has_data": True,
            "period_days": days,
            "currency": "INR",
            "summary": {
                "total_spent": round(total_spent, 2),
                "total_received": round(total_received, 2),
                "net_flow": round(total_received - total_spent, 2),
                "transaction_count": transaction_count,
                "avg_daily_spend": round(avg_daily_spend, 2)
            },
            "top_categories": [
                {"name": cat, "amount": round(amt, 2), "percentage": round((amt / total_spent) * 100, 1) if total_spent > 0 else 0}
                for cat, amt in top_categories
            ],
            "top_merchants": [
                {"name": m, "amount": round(amt, 2)}
                for m, amt in top_merchants
            ],
            "daily_trend": daily_trend
        }
    
    async def get_spending_insights(self, days: int = 30) -> List[Dict[str, Any]]:
        """Generate AI-powered spending insights."""
        summary = await self.get_spending_summary(days)
        
        if not summary.get("has_data"):
            return []
        
        insights = []
        
        # Compare to previous period
        prev_summary = await self.get_spending_summary(days * 2)
        if prev_summary.get("has_data"):
            current_spend = summary["summary"]["total_spent"]
            prev_spend = prev_summary["summary"]["total_spent"] / 2  # Average of double period
            
            if current_spend > prev_spend * 1.2:
                diff = current_spend - prev_spend
                insights.append({
                    "type": "overspend",
                    "priority": "high",
                    "icon": "trending-up",
                    "message": f"You spent ₹{diff:,.0f} more than usual this month!",
                    "detail": f"Current: ₹{current_spend:,.0f} vs Average: ₹{prev_spend:,.0f}"
                })
            elif current_spend < prev_spend * 0.8:
                savings = prev_spend - current_spend
                insights.append({
                    "type": "savings",
                    "priority": "low",
                    "icon": "trending-down",
                    "message": f"Great! You saved ₹{savings:,.0f} compared to usual.",
                    "detail": f"Current: ₹{current_spend:,.0f} vs Average: ₹{prev_spend:,.0f}"
                })
        
        # Top category insight
        top_cats = summary.get("top_categories", [])
        if top_cats:
            top = top_cats[0]
            insights.append({
                "type": "top_category",
                "priority": "medium",
                "icon": "pie-chart",
                "message": f"Top spending: {top['name'].title()} (₹{top['amount']:,.0f})",
                "detail": f"{top['percentage']}% of total spending"
            })
        
        # High spending days
        daily = summary.get("daily_trend", [])
        avg_daily = summary["summary"]["avg_daily_spend"]
        high_days = [d for d in daily if d["spent"] > avg_daily * 2]
        if high_days:
            insights.append({
                "type": "high_spend_day",
                "priority": "medium",
                "icon": "alert-circle",
                "message": f"You had {len(high_days)} high-spending days (>₹{avg_daily*2:,.0f})",
                "detail": "Consider reviewing these transactions"
            })
        
        # Subscription detection (recurring similar amounts)
        # This is a simplified version - could be enhanced
        
        return insights
    
    async def get_category_breakdown(self, days: int = 30) -> Dict[str, Any]:
        """Get detailed category breakdown."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        
        pipeline = [
            {"$match": {"kind": "transaction", "direction": "debit", "posted_at": {"$gte": cutoff}}},
            {"$group": {
                "_id": "$category",
                "total": {"$sum": "$amount"},
                "count": {"$sum": 1},
                "merchants": {"$addToSet": "$merchant"}
            }},
            {"$sort": {"total": -1}}
        ]
        
        results = []
        async for doc in self.db.notifications.aggregate(pipeline):
            results.append({
                "category": doc["_id"] or "other",
                "total": round(doc["total"], 2),
                "count": doc["count"],
                "top_merchants": doc["merchants"][:5]
            })
        
        return {"categories": results, "period_days": days}
    
    async def get_recurring_transactions(self) -> List[Dict[str, Any]]:
        """Detect recurring transactions (subscriptions, EMIs)."""
        # Get last 90 days of transactions
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        
        transactions = await self.db.notifications.find({
            "kind": "transaction",
            "direction": "debit",
            "posted_at": {"$gte": cutoff}
        }, {"_id": 0}).to_list(500)
        
        # Group by merchant and similar amounts
        by_merchant: Dict[str, List[Dict]] = defaultdict(list)
        for tx in transactions:
            merchant = tx.get("merchant", "Unknown")
            by_merchant[merchant].append(tx)
        
        recurring = []
        for merchant, txs in by_merchant.items():
            if len(txs) >= 2:
                # Check if amounts are similar (within 10%)
                amounts = [t.get("amount", 0) for t in txs if t.get("amount")]
                if amounts:
                    avg_amount = sum(amounts) / len(amounts)
                    similar = all(abs(a - avg_amount) / avg_amount < 0.1 for a in amounts)
                    
                    if similar and len(txs) >= 2:
                        recurring.append({
                            "merchant": merchant,
                            "amount": round(avg_amount, 2),
                            "frequency": "monthly" if len(txs) <= 4 else "weekly",
                            "occurrences": len(txs),
                            "category": txs[0].get("category", "subscription")
                        })
        
        return sorted(recurring, key=lambda x: x["amount"], reverse=True)



# ==================== GMAIL TRANSACTION SCANNER ====================

# Gmail search query for finance-related emails
FINANCE_GMAIL_QUERY = (
    '(debited OR credited OR "you paid" OR "you spent" OR "amount received" '
    'OR "received from" OR "transferred to" OR UPI OR IMPS OR NEFT OR RTGS '
    'OR "credit card" OR "debit card" OR "card was used" OR "transaction alert" '
    'OR "spent on your" OR "has been credited" OR "has been debited" OR "payment of") '
)

# Senders that are known finance sources
_FINANCE_SENDER_HINTS = (
    "alerts@", "noreply@", "no-reply@", "statements@", "ealerts@",
    "@hdfcbank", "@icicibank", "@axisbank", "@sbi.co.in", "@kotak", "@yesbank",
    "@indusind", "@idfcfirstbank", "@rblbank", "@federalbank",
    "@paytm", "@phonepe", "@gpay", "@cred", "@razorpay", "@billdesk", "@instamojo",
    "@amazon", "@flipkart", "@swiggy", "@zomato", "@uber", "@ola", "@netflix",
    "@americanexpress", "@aexp", "@onecard",
)


def _looks_like_finance_sender(sender: str) -> bool:
    s = (sender or "").lower()
    return any(hint in s for hint in _FINANCE_SENDER_HINTS)


class GmailFinanceScanner:
    """Scans Gmail for bank / UPI / credit-card emails and turns them into transactions."""

    def __init__(self, db, brain: "PersonalFinanceBrain"):
        self.db = db
        self.brain = brain

    async def scan(self, token: str, helper, days: int = 30, max_messages: int = 100) -> Dict[str, Any]:
        """Scan recent Gmail for financial transactions.

        - `helper`: the google_helper module (passed in to avoid circular import).
        Returns {scanned, new_transactions, total_after_scan}.
        """
        query = f"{FINANCE_GMAIL_QUERY} newer_than:{max(1, int(days))}d"
        try:
            messages = await helper.search_messages_full(token, query, max_results=max_messages)
        except Exception as e:
            logger.warning(f"Gmail finance scan failed: {e}")
            return {"scanned": 0, "new_transactions": 0, "error": str(e)[:200]}

        new_count = 0
        senders_seen = []
        for m in messages:
            mid = m.get("id")
            if not mid:
                continue
            # Dedupe by gmail message id
            already = await self.db.notifications.find_one({"gmail_msg_id": mid})
            if already:
                continue

            sender = m.get("from", "")
            subject = m.get("subject", "")
            body = m.get("body", "") or m.get("snippet", "")
            full_text = f"{subject}\n{body}"[:4000]

            # Quick sanity: bail out if neither subject nor body has any money keyword
            ftl = full_text.lower()
            if not any(kw in ftl for kw in (
                "debited", "credited", "₹", "rs.", "rs ", " inr", "spent", "paid",
                "received", "transferred", "card was used", "amount", "txn", "transaction",
                "purchase", "upi", "imps", "neft", "rtgs", "credit card", "debit card",
            )):
                continue

            amount = parse_amount_from_text(full_text)
            if amount is None or amount <= 0:
                continue
            direction = detect_transaction_direction(full_text)
            upi_id = parse_upi_id(full_text)

            # Merchant: try snippet/body patterns first, then sender domain
            merchant = self._extract_merchant_from_email(full_text, upi_id, sender)
            category = categorize_transaction(merchant, full_text)
            source = self._detect_source_from_email(sender, full_text)

            # Use the email's internal date if available
            ts = m.get("internal_ts")
            if ts:
                try:
                    posted_at = datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
                except Exception:
                    posted_at = datetime.now(timezone.utc).isoformat()
            else:
                posted_at = datetime.now(timezone.utc).isoformat()

            doc = {
                "id": str(uuid.uuid4()),
                "kind": "transaction",
                "amount": amount,
                "direction": direction,
                "category": category,
                "merchant": merchant,
                "upi_id": upi_id,
                "source": source,
                "currency": "INR",
                "raw_text": (subject + " — " + body)[:500],
                "posted_at": posted_at,
                "gmail_msg_id": mid,
                "gmail_from": sender,
                "gmail_subject": subject,
            }
            await self.db.notifications.insert_one(doc)
            new_count += 1
            senders_seen.append(sender)

        # Record sync metadata
        await self.db.sync_state.update_one(
            {"id": "finance_gmail"},
            {"$set": {
                "id": "finance_gmail",
                "last_run_at": datetime.now(timezone.utc).isoformat(),
                "last_scanned": len(messages),
                "last_new": new_count,
                "days": days,
            }},
            upsert=True,
        )

        total = await self.db.notifications.count_documents({"kind": "transaction"})
        return {
            "scanned": len(messages),
            "new_transactions": new_count,
            "total_after_scan": total,
            "senders_seen": list(set(senders_seen))[:20],
        }

    @staticmethod
    def _extract_merchant_from_email(text: str, upi_id: Optional[str], sender: str) -> str:
        # 1) UPI ID -> handle name
        if upi_id:
            handle = upi_id.split("@")[0].replace(".", " ").replace("_", " ").strip()
            if len(handle) > 2 and not handle.isdigit():
                return handle.title()

        # 2) Common email patterns
        patterns = [
            r"(?:at|to|in favor of|in favour of|towards)\s+([A-Z0-9][A-Za-z0-9 &.'-]{2,40}?)(?:\s+on|\s+for|\s+via|\s+ref|\s+vide|\.|$)",
            r"(?:VPA|UPI ID)[^A-Za-z0-9]*([A-Za-z0-9.@_-]+)",
            r"merchant\s*:?\s*([A-Z0-9][A-Za-z0-9 &.'-]{2,40})",
        ]
        for pat in patterns:
            m = re.search(pat, text)
            if m:
                cand = m.group(1).strip().strip(".,;:")
                if 2 < len(cand) < 60:
                    return cand.title()

        # 3) Fallback: sender domain
        m = re.search(r"@([A-Za-z0-9.-]+)", sender or "")
        if m:
            dom = m.group(1).split(".")[0]
            return dom.title()
        return "Unknown"

    @staticmethod
    def _detect_source_from_email(sender: str, text: str) -> str:
        combined = f"{sender} {text}".lower()
        for bank, pattern in BANK_PATTERNS.items():
            if re.search(pattern, combined, re.IGNORECASE):
                return bank.upper()
        # Try the sender domain itself
        m = re.search(r"@([A-Za-z0-9.-]+)", sender or "")
        if m:
            return m.group(1).split(".")[0].upper()
        return "BANK"


async def get_last_sync(db) -> Optional[Dict[str, Any]]:
    return await db.sync_state.find_one({"id": "finance_gmail"}, {"_id": 0})
