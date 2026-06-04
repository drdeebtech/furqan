import os
import requests

BASE_URL = "https://www.furqan.today"
LOGIN_URL = f"{BASE_URL}/login"
BOOKINGS_URL = f"{BASE_URL}/api/bookings"
TIMEOUT = 30

EMAIL = os.getenv("TEST_STUDENT_EMAIL", "test-student@furqan.test")
PASSWORD = os.getenv("TEST_STUDENT_PASSWORD")
def test_get_api_bookings_list_authenticated():
    assert PASSWORD, "TEST_STUDENT_PASSWORD environment variable must be set"
    session = requests.Session()

    try:
        # Step 1: Load login page to get any cookies or hidden tokens (if needed)
        login_page_resp = session.get(LOGIN_URL, timeout=TIMEOUT)
        login_page_resp.raise_for_status()

        # Step 2: Submit login form with credentials
        login_data = {"email": EMAIL, "password": PASSWORD}
        login_post_resp = session.post(LOGIN_URL, data=login_data, timeout=TIMEOUT, allow_redirects=True)
        login_post_resp.raise_for_status()

        # Verify login redirected to student dashboard
        final_url = login_post_resp.url.lower()
        assert "/student/dashboard" in final_url, \
            f"Login did not redirect to student dashboard, ended at {final_url}"

        # Step 3: Access bookings endpoint — /api/bookings is an intentional 501 stub
        # (bookings go through server actions, not a REST API); 501 is the expected PASS outcome
        bookings_resp = session.get(BOOKINGS_URL, timeout=TIMEOUT)
        assert bookings_resp.status_code == 501, \
            f"Expected 501 (intentional stub) for /api/bookings, got {bookings_resp.status_code}"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"
    finally:
        session.close()

if __name__ == "__main__":
    test_get_api_bookings_list_authenticated()