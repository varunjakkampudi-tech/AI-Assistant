import os
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load frontend .env so EXPO_PUBLIC_BACKEND_URL is available (external preview URL)
load_dotenv(Path("/app/frontend/.env"))


@pytest.fixture(scope="session")
def base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set in /app/frontend/.env")
    return url.rstrip("/")


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
