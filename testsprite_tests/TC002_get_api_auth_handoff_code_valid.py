import requests
from requests.sessions import Session
from urllib.parse import urljoin

BASE_URL = "https://www.furqan.today"
HANDOFF_PATH = "/api/auth/handoff/"
TIMEOUT = 30

INVALID_HANDOFF_CODE = "invalidcode123"

def test_get_api_auth_handoff_code_invalid():
    session = Session()
    try:
        # Attempt to GET /api/auth/handoff/[invalid_code] expecting 404
        handoff_url = urljoin(BASE_URL, HANDOFF_PATH + INVALID_HANDOFF_CODE)
        response = session.get(handoff_url, timeout=TIMEOUT)
        assert response.status_code == 404, f"Expected 404 for invalid handoff code, got {response.status_code}"
        assert "Invalid or expired code" in response.text, "Expected error message for invalid or expired code"
    finally:
        session.close()


test_get_api_auth_handoff_code_invalid()
