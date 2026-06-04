import os
import re
import requests
from urllib.parse import urljoin

BASE_URL = "https://www.furqan.today"
LOGIN_URL = f"{BASE_URL}/login"
TIMEOUT = 30

EMAIL = os.getenv("TEST_STUDENT_EMAIL")
PASSWORD = os.getenv("TEST_STUDENT_PASSWORD")

def test_get_api_auth_callback_google_success():
    """Login with email/password, assert redirect to /student/dashboard, verify Arabic RTL HTML."""
    assert EMAIL, "TEST_STUDENT_EMAIL environment variable must be set"
    assert PASSWORD, "TEST_STUDENT_PASSWORD environment variable must be set"
    with requests.Session() as session:
        session.headers.update({"Accept-Language": "ar"})  # Arabic RTL UI

        try:
            login_page = session.get(LOGIN_URL, timeout=TIMEOUT)
            login_page.raise_for_status()
        except requests.RequestException as e:
            raise AssertionError(f"Failed to load login page: {e}") from e

        payload = {"email": EMAIL, "password": PASSWORD}
        headers = {"Referer": LOGIN_URL}

        try:
            post_login = session.post(
                LOGIN_URL, data=payload, headers=headers, timeout=TIMEOUT, allow_redirects=False
            )
            post_login.raise_for_status()
        except requests.RequestException as e:
            raise AssertionError(f"Login POST request failed: {e}") from e

        assert post_login.status_code in (302, 303), \
            f"Expected redirect after login, got {post_login.status_code}"
        location = post_login.headers.get("Location", "")
        assert location, "Redirect location header missing after login"
        assert "/student/dashboard" in location, \
            f"Unexpected redirect location after login: {location}"

        try:
            dashboard_resp = session.get(urljoin(BASE_URL, location), timeout=TIMEOUT)
            dashboard_resp.raise_for_status()
        except requests.RequestException as e:
            raise AssertionError(f"Failed to load dashboard page: {e}") from e

        html_lower = dashboard_resp.text.lower()
        assert re.search(r'\blang\s*=\s*["\']?ar["\']?', html_lower), \
            "Dashboard page lang attribute is not Arabic"
        assert re.search(r'\bdir\s*=\s*["\']?rtl["\']?', html_lower), \
            "Dashboard page dir attribute is not rtl"

        body_text = dashboard_resp.text
        assert "مستخدم" in body_text or "اللوحة" in body_text, \
            "Dashboard does not appear to show authenticated student content"

if __name__ == "__main__":
    test_get_api_auth_callback_google_success()
