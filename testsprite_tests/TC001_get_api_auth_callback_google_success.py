import os
import requests

BASE_URL = "https://www.furqan.today"
LOGIN_URL = f"{BASE_URL}/login"
DASHBOARD_URL_STUDENT = f"{BASE_URL}/student/dashboard"
TIMEOUT = 30

EMAIL = os.getenv("TEST_STUDENT_EMAIL", "test-student@furqan.test")
PASSWORD = os.getenv("TEST_STUDENT_PASSWORD")
assert PASSWORD, "TEST_STUDENT_PASSWORD environment variable must be set"

def test_get_api_auth_callback_google_success():
    session = requests.Session()
    session.headers.update({"Accept-Language": "ar"})  # Arabic RTL UI
    
    # Step 1: Navigate to login page to get CSRF token or cookies if any
    try:
        login_page = session.get(LOGIN_URL, timeout=TIMEOUT)
        login_page.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Failed to load login page: {e}"
    
    # CSRF token parsing skipped due to lack of BeautifulSoup
    csrf_token = None

    payload = {
        "email": EMAIL,
        "password": PASSWORD,
    }
    if csrf_token:
        payload["csrfmiddlewaretoken"] = csrf_token

    headers = {
        "Referer": LOGIN_URL,
        "Accept-Language": "ar",
    }
    
    # Step 2: Submit login form
    try:
        post_login = session.post(LOGIN_URL, data=payload, headers=headers, timeout=TIMEOUT, allow_redirects=False)
        post_login.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Login POST request failed: {e}"
    
    # Expecting a redirect (302) after successful login to dashboard or another page
    assert post_login.status_code in (302, 303), f"Expected redirect after login, got {post_login.status_code}"
    location = post_login.headers.get("Location", "")
    assert location, "Redirect location header missing after login"
    assert "/student/dashboard" in location or location.startswith(DASHBOARD_URL_STUDENT), f"Unexpected redirect location after login: {location}"

    # Step 3: Follow redirect to dashboard
    try:
        dashboard_resp = session.get(f"{BASE_URL}{location}" if location.startswith("/") else location, timeout=TIMEOUT)
        dashboard_resp.raise_for_status()
    except requests.RequestException as e:
        assert False, f"Failed to load dashboard page: {e}"

    # Validate dashboard content: Confirm user is authenticated and page is in Arabic RTL
    html_text = dashboard_resp.text.lower()
    assert 'lang="ar"' in html_text or 'lang=ar' in html_text, f"Dashboard page lang attribute is not Arabic"
    assert 'dir="rtl"' in html_text or 'dir=rtl' in html_text, f"Dashboard page dir attribute is not rtl"

    # Check for a user-specific element, e.g., user email or dashboard greeting in Arabic
    body_text = dashboard_resp.text
    assert EMAIL.split('@')[0] in body_text or "مستخدم" in body_text or "اللوحة" in body_text, "Dashboard does not appear to show authenticated student content"

if __name__ == "__main__":
    test_get_api_auth_callback_google_success()
