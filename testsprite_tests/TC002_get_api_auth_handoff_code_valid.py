import requests
from urllib.parse import urljoin

BASE_URL = "https://www.furqan.today"
HANDOFF_PATH = "/api/auth/handoff/"
TIMEOUT = 30

INVALID_HANDOFF_CODE = "invalidcode123"

def test_get_api_auth_handoff_code_invalid():
    """Invalid/expired handoff code must return HTTP 410 Gone."""
    with requests.Session() as session:
        try:
            # Attempt to GET /api/auth/handoff/[invalid_code] expecting 410 Gone
            # (one-time-use token that no longer exists — 410 is semantically correct)
            handoff_url = urljoin(BASE_URL, HANDOFF_PATH + INVALID_HANDOFF_CODE)
            response = session.get(handoff_url, timeout=TIMEOUT)
        except requests.RequestException as e:
            raise AssertionError(f"Failed to reach handoff endpoint: {e}") from e
        assert response.status_code == 410, f"Expected 410 for invalid/expired handoff code, got {response.status_code}"


if __name__ == "__main__":
    test_get_api_auth_handoff_code_invalid()
