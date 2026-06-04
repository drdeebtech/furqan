import requests

def test_get_api_auth_handoff_code_valid():
    base_url = "https://www.furqan.today"
    # Use a fake one-time handoff code known to be invalid/expired in production
    fake_code = "invalid-fake-code-1234567890"
    url = f"{base_url}/api/auth/handoff/{fake_code}"
    try:
        response = requests.get(url, allow_redirects=False, timeout=30)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    # According to instructions, a GET with invalid/expired code returns HTTP 410 Gone and that is considered pass
    assert response.status_code == 410, f"Expected status code 410, got {response.status_code}"

test_get_api_auth_handoff_code_valid()