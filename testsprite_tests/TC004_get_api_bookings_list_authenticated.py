import requests

def test_get_api_bookings_list_authenticated():
    base_url = "http://localhost:3000"
    login_url = f"{base_url}/api/auth/test-login"
    bookings_url = f"{base_url}/api/bookings"
    headers = {
        "x-test-login-secret": "8b84315facd1cdcf38d4cd93a3c6ccfcb4a8bf139de3a625",
        "Content-Type": "application/json",
    }
    login_payload = {"role": "student"}
    timeout = 30

    session = requests.Session()
    try:
        # Authenticate and obtain session cookie
        login_resp = session.post(login_url, headers=headers, json=login_payload, timeout=timeout)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"

        # Access GET /api/bookings with authenticated session
        bookings_resp = session.get(bookings_url, timeout=timeout)
        # According to instructions, 501 is acceptable for this stub endpoint as well as 200
        assert bookings_resp.status_code in (200, 501), f"Unexpected status code {bookings_resp.status_code}"

        if bookings_resp.status_code == 200:
            # Expecting a list of Booking objects (assumed JSON array)
            data = bookings_resp.json()
            assert isinstance(data, list), "Expected a list of Booking objects"
        else:
            # 501 Not Implemented - acceptable stub
            pass
    finally:
        # No resource created, nothing to clean up
        session.close()

test_get_api_bookings_list_authenticated()