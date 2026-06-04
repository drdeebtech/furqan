import requests
import hmac
import hashlib
import json

def test_post_api_webhooks_daily_valid_signature():
    base_url = "https://www.furqan.today"
    endpoint = "/api/webhooks/daily"
    url = base_url + endpoint
    timeout = 30

    # Sample Daily.co event payload (typical minimal example)
    event_payload = {
        "event": "participant_joined",
        "room_id": "testroom123",
        "participant_id": "participant123",
        "timestamp": "2026-06-03T12:00:00Z"
    }
    body_bytes = json.dumps(event_payload).encode('utf-8')

    # The production webhook secret must be known. 
    # TestSprite or environment does not provide secret, so simulate a valid signature using a placeholder.
    # In a live test environment, for this unauthenticated perimeter test, we rely on the fact the test is run
    # with a valid signature (known secret).
    # Here, generate HMAC-SHA256 signature with assumed secret.
    # NOTE: Replace 'your_actual_daily_webhook_secret' with the real secret to actually run this test.
    daily_webhook_secret = "your_actual_daily_webhook_secret"
    signature = hmac.new(
        daily_webhook_secret.encode('utf-8'),
        body_bytes,
        hashlib.sha256
    ).hexdigest()

    headers = {
        'Content-Type': 'application/json',
        'x-daily-signature': signature
    }

    try:
        response = requests.post(url, headers=headers, data=body_bytes, timeout=timeout)
    except requests.RequestException as e:
        assert False, f"Request to {url} failed: {e}"

    # Validate response code 200 means accepted and processed
    assert response.status_code == 200, f"Expected 200 OK but got {response.status_code} with body: {response.text}"

test_post_api_webhooks_daily_valid_signature()