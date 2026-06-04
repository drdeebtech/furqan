import requests

BASE_URL = "http://localhost:3000"

def test_post_api_stripe_checkout_valid_package():
    login_url = f"{BASE_URL}/api/auth/test-login"
    checkout_url = f"{BASE_URL}/api/stripe/checkout"
    headers = {
        "x-test-login-secret": "8b84315facd1cdcf38d4cd93a3c6ccfcb4a8bf139de3a625",
        "Content-Type": "application/json"
    }
    package_id = "ae871488-1755-4dd4-ba48-39d94e7f8504"
    session = requests.Session()

    # Step 1: Authenticate as student role
    login_payload = {"role": "student"}
    try:
        login_resp = session.post(login_url, json=login_payload, headers=headers, timeout=30)
        assert login_resp.status_code == 200 or login_resp.status_code == 204 or login_resp.status_code == 201, \
            f"Login failed with status code {login_resp.status_code}"
    except requests.RequestException as e:
        assert False, f"Exception during login request: {e}"

    # Step 2: POST to /api/stripe/checkout with package_id
    checkout_payload = {"package_id": package_id}
    try:
        resp = session.post(checkout_url, json=checkout_payload, timeout=30)
    except requests.RequestException as e:
        assert False, f"Exception during checkout request: {e}"

    # Step 3: Validate response
    # Expected: 501 with {"error":"Stripe SDK not yet installed"}
    assert resp.status_code == 501, f"Expected status 501, got {resp.status_code}"
    try:
        resp_json = resp.json()
    except ValueError:
        assert False, "Response is not valid JSON"
    assert "error" in resp_json, "Response JSON missing 'error' field"
    assert resp_json["error"] == "Stripe SDK not yet installed", \
        f"Unexpected error message: {resp_json['error']}"

test_post_api_stripe_checkout_valid_package()