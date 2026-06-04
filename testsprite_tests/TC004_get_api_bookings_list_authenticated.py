import requests

def test_get_api_bookings_list_authenticated():
    base_url = "https://www.furqan.today"
    login_url = f"{base_url}/login"
    bookings_url = f"{base_url}/api/bookings"
    session = requests.Session()
    timeout = 30

    # Credentials for student
    email = "test-student@furqan.test"
    password = "Ts!WrLDsj5BFsPnO6hG"

    try:
        # Step 1: Load login page to get any cookies or hidden tokens (if needed)
        login_page_resp = session.get(login_url, timeout=timeout)
        login_page_resp.raise_for_status()

        # Step 2: Submit login form with credentials
        # Assuming login form accepts form data 'email' and 'password' fields
        login_data = {
            "email": email,
            "password": password
        }
        login_post_resp = session.post(login_url, data=login_data, timeout=timeout, allow_redirects=True)
        login_post_resp.raise_for_status()

        # Check if login was successful by verifying redirect to dashboard or a successful page load
        # We expect a 200 or 302 redirect eventually
        final_url = login_post_resp.url.lower()
        assert "dashboard" in final_url or login_post_resp.status_code in (200, 302), \
            f"Login failed or did not redirect to dashboard, ended at {final_url}"

        # Step 3: Access bookings endpoint with authenticated session
        bookings_resp = session.get(bookings_url, timeout=timeout)
        # Validate 200 for authenticated bookings list
        assert bookings_resp.status_code == 200, f"Expected 200 OK but got {bookings_resp.status_code}"
        bookings_json = bookings_resp.json()
        # bookings_json should be a list (Booking[])
        assert isinstance(bookings_json, list), f"Expected bookings list but got {type(bookings_json)}"

        # Optionally, verify contents of bookings list if non-empty
        if bookings_json:
            booking = bookings_json[0]
            assert isinstance(booking, dict), "Booking item should be a dictionary/object"

    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

test_get_api_bookings_list_authenticated()