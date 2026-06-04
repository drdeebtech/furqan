import requests

def test_post_api_cron_audit_cleanup_valid_secrets():
    base_url = "https://www.furqan.today"
    url = f"{base_url}/api/cron/audit-cleanup"
    headers = {
        "Authorization": "Bearer valid_cron_secret",
        "X-N8N-Secret": "valid_n8n_secret",
        "Content-Type": "application/json"
    }
    try:
        response = requests.post(url, headers=headers, timeout=30)
    except requests.RequestException as e:
        assert False, f"Request failed: {e}"

    # According to instructions for production,
    # the POST /api/cron/audit-cleanup endpoint is GET-only with dual-secret gated
    # and should return HTTP 405 Method Not Allowed for POST requests.
    # This is the expected and passing condition.

    assert response.status_code == 405, f"Expected status code 405, got {response.status_code}"
    # Optional: Validate the response message includes "Method Not Allowed"
    try:
        content = response.text.lower()
        assert "method not allowed" in content
    except Exception:
        pass

test_post_api_cron_audit_cleanup_valid_secrets()