import os
import requests

BASE_URL = os.getenv("TEST_BASE_URL", "https://www.furqan.today")
LOGIN_URL = f"{BASE_URL}/login"
BOOKINGS_URL = f"{BASE_URL}/api/bookings"
TIMEOUT = 30

EMAIL = os.getenv("TEST_STUDENT_EMAIL")
PASSWORD = os.getenv("TEST_STUDENT_PASSWORD")

def test_get_api_bookings_list_authenticated():
    """Authenticated student calling /api/bookings must receive HTTP 501 (intentional stub)."""
    assert EMAIL, "TEST_STUDENT_EMAIL environment variable must be set"
    assert PASSWORD, "TEST_STUDENT_PASSWORD environment variable must be set"
    with requests.Session() as session:
        try:
            login_page_resp = session.get(LOGIN_URL, timeout=TIMEOUT)
            login_page_resp.raise_for_status()
        except requests.RequestException as e:
            raise AssertionError(f"Failed to load login page: {e}") from e

        try:
            login_data = {"email": EMAIL, "password": PASSWORD}
            login_post_resp = session.post(LOGIN_URL, data=login_data, timeout=TIMEOUT, allow_redirects=True)
            login_post_resp.raise_for_status()
        except requests.RequestException as e:
            raise AssertionError(f"Login POST request failed: {e}") from e

        final_url = login_post_resp.url.lower()
        assert "/student/dashboard" in final_url, \
            f"Login did not redirect to student dashboard, ended at {final_url}"

        try:
            # /api/bookings is an intentional 501 stub — bookings go through server actions
            bookings_resp = session.get(BOOKINGS_URL, timeout=TIMEOUT)
        except requests.RequestException as e:
            raise AssertionError(f"Failed to call /api/bookings: {e}") from e

        assert bookings_resp.status_code == 501, \
            f"Expected 501 (intentional stub) for /api/bookings, got {bookings_resp.status_code}"

if __name__ == "__main__":
    test_get_api_bookings_list_authenticated()
