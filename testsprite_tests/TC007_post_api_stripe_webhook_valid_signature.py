import requests
import json

def test_post_api_stripe_webhook_valid_signature():
    base_url = "https://www.furqan.today"
    url = f"{base_url}/api/stripe/webhook"
    timeout = 30

    # Example Stripe event payload (simplified minimal valid event)
    payload = {
        "id": "evt_1Example1234567890",
        "object": "event",
        "api_version": "2022-11-15",
        "created": 1672531200,
        "data": {
            "object": {
                "id": "cs_test_123",
                "object": "checkout.session",
                "payment_status": "paid",
                "client_reference_id": "test_123"
            }
        },
        "livemode": True,
        "pending_webhooks": 1,
        "request": {
            "id": "req_1234567890",
            "idempotency_key": None
        },
        "type": "checkout.session.completed"
    }
    
    # The Stripe-Signature header is required to verify signature.
    # Since this is a perimeter test on live production, and the service expects a valid signature,
    # but we cannot generate a real signature here, any signature will be invalid.
    # According to the instructions for TC007, the webhook is hard-disabled by design and should return 501.
    # We provide a plausible but fake signature header.
    
    headers = {
        "Content-Type": "application/json",
        "Stripe-Signature": "t=12345,v1=fakesignature"
    }

    try:
        response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=timeout)
    except requests.RequestException as e:
        assert False, f"Request to {url} failed with exception: {e}"

    # According to the test instructions / expected results for TC007:
    # POST /api/stripe/webhook returns HTTP 501 (webhook hard-disabled by design)
    # Treat 501 as pass.
    assert response.status_code == 501, f"Expected status code 501 but got {response.status_code}. Response text: {response.text}"

test_post_api_stripe_webhook_valid_signature()