import requests

def test_post_api_bookings_create_authenticated():
    base_url = "http://localhost:3000"
    login_url = f"{base_url}/api/auth/test-login"
    bookings_url = f"{base_url}/api/bookings"
    login_secret = "8b84315facd1cdcf38d4cd93a3c6ccfcb4a8bf139de3a625"
    role = "student"
    timeout = 30

    session = requests.Session()

    try:
        # Step 1: Obtain authenticated session cookie via test-login
        login_headers = {
            "x-test-login-secret": login_secret,
            "Content-Type": "application/json"
        }
        login_payload = {"role": role}

        login_resp = session.post(login_url, headers=login_headers, json=login_payload, timeout=timeout)
        assert login_resp.status_code == 200, f"Auth login failed with status {login_resp.status_code}"

        # Step 2: POST valid booking data to /api/bookings
        # Since no booking schema was provided, use a plausible booking payload
        booking_payload = {
            "teacherId": "teacher-uuid-1234",      # Example valid teacher ID (replace with your test data if needed)
            "studentId": "student-uuid-5678",      # Example student ID that matches authenticated user or test case
            "startTime": "2026-06-10T10:00:00Z",  # ISO8601 datetime string (future date)
            "endTime": "2026-06-10T11:00:00Z",    # ISO8601 datetime string after startTime
            "subject": "Quran lesson",
            "notes": "Test booking creation"
        }

        post_resp = session.post(bookings_url, json=booking_payload, timeout=timeout)
        # According to instructions, this stub endpoint returns 501 by design which is acceptable
        assert post_resp.status_code in (200, 501), f"Unexpected status code {post_resp.status_code}"

        if post_resp.status_code == 200:
            # Validate that response contains created Booking record keys
            data = post_resp.json()
            assert isinstance(data, dict), "Response is not a JSON object"
            # Check some expected keys in booking record
            expected_keys = {"id", "teacherId", "studentId", "startTime", "endTime", "subject", "notes"}
            assert expected_keys.issubset(data.keys()), f"Missing keys in booking record: {expected_keys - data.keys()}"

    finally:
        session.close()

test_post_api_bookings_create_authenticated()