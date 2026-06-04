import requests

def test_post_api_auth_logout_authenticated():
    base_url = "http://localhost:3000"
    login_url = f"{base_url}/api/auth/test-login"
    logout_url = f"{base_url}/api/auth/logout"
    test_login_secret = "8b84315facd1cdcf38d4cd93a3c6ccfcb4a8bf139de3a625"
    role = "student"

    with requests.Session() as session:
        # Obtain authenticated session
        login_headers = {
            "x-test-login-secret": test_login_secret,
            "Content-Type": "application/json"
        }
        login_payload = {"role": role}
        login_resp = session.post(login_url, json=login_payload, headers=login_headers, timeout=30)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        
        # Confirm session cookie(s) set
        auth_cookies = [c for c in session.cookies if c.name.startswith('sb-') and c.name.endswith('auth-token')]
        assert auth_cookies, "Supabase auth session cookie not set after login"
        
        # Post logout request
        logout_resp = session.post(logout_url, allow_redirects=False, timeout=30)
        assert logout_resp.status_code in (302, 307), f"Expected 302 or 307 redirect, got {logout_resp.status_code}"
        location = logout_resp.headers.get("Location", "")
        # Verify redirect to home page or root path "/" or /login
        assert location in ("/", f"{base_url}/", "/login"), f"Logout redirect location unexpected: {location}"

        # After logout, session cookies should be cleared or expired
        # Check that auth cookies are deleted or expired
        cookies_post_logout = session.cookies
        for c in cookies_post_logout:
            if c.name.startswith('sb-') and c.name.endswith('auth-token'):
                assert c.is_expired() or c.value == "", "Session cookie still present after logout"

test_post_api_auth_logout_authenticated()
