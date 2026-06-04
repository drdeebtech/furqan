import requests

def test_get_api_n8n_workflows_admin_authenticated():
    base_url = "http://localhost:3000"
    login_url = f"{base_url}/api/auth/test-login"
    workflows_url = f"{base_url}/api/n8n/workflows"
    headers = {
        "x-test-login-secret": "8b84315facd1cdcf38d4cd93a3c6ccfcb4a8bf139de3a625",
        "Content-Type": "application/json"
    }

    with requests.Session() as session:
        # Authenticate as admin
        response = session.post(
            login_url,
            headers=headers,
            json={"role": "admin"},
            timeout=30,
        )
        assert response.status_code == 200, f"Auth failed with status {response.status_code}"

        # Use authenticated session to GET /api/n8n/workflows
        workflows_response = session.get(workflows_url, timeout=30)

        # According to instructions:
        # Expected result in local environment: HTTP 500 with {"error":"...N8N_API_URL not configured"}
        # Any 401/403 would indicate auth failure and thus fail the test.
        if workflows_response.status_code in (401, 403):
            raise AssertionError(f"Access denied with status {workflows_response.status_code} and body: {workflows_response.text}")

        assert workflows_response.status_code in (200, 500), (
            f"Unexpected status code {workflows_response.status_code} with body: {workflows_response.text}"
        )
        try:
            resp_json = workflows_response.json()
        except Exception as e:
            raise AssertionError(f"Response is not valid JSON: {workflows_response.text}") from e

        # If 500, expect error message containing "N8N_API_URL not configured"
        if workflows_response.status_code == 500:
            assert "error" in resp_json, f"500 response missing 'error' field: {resp_json}"
            assert "N8N_API_URL not configured" in resp_json["error"], f"Unexpected error message: {resp_json['error']}"
        else:
            # 200 response should return a list (possibly empty) of workflows
            assert isinstance(resp_json, list), f"Expected list of workflows, got: {resp_json}"

test_get_api_n8n_workflows_admin_authenticated()