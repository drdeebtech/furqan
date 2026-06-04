import requests

def test_get_api_auth_callback_google_success():
    base_url = "https://www.furqan.today"
    endpoint = "/api/auth/callback/google"
    fake_code = "fake"
    params = {"code": fake_code}
    timeout = 30

    try:
        response = requests.get(f"{base_url}{endpoint}", params=params, allow_redirects=False, timeout=timeout)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    # Validate that the response is a redirect (3xx)
    assert response.status_code in range(300, 400), f"Expected 3xx redirect, got {response.status_code}"

    location = response.headers.get("Location", "")
    # The redirect location should NOT go to /dashboard but should contain "/login" with an error param indicating oauth_exchange_failed or similar
    assert "/login" in location, f"Redirect location should contain '/login', got: {location}"
    assert "error" in location, f"Redirect location should contain 'error' query param, got: {location}"

test_get_api_auth_callback_google_success()