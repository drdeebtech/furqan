import requests
import hmac
import hashlib
import time
import json

BASE_URL = "https://www.furqan.today"
WEBHOOK_ENDPOINT = "/api/stripe/webhook"
TIMEOUT = 30

def test_post_api_stripe_webhook_valid_signature():
    # Example Stripe event payload to simulate a checkout.session.completed event
    payload = {
        "id": "evt_test_webhook",
        "object": "event",
        "api_version": "2020-08-27",
        "created": int(time.time()),
        "data": {
            "object": {
                "id": "cs_test_session",
                "object": "checkout.session",
                "amount_total": 2000,
                "currency": "usd",
                "payment_status": "paid",
                "customer_email": "customer@example.com",
                "metadata": {},
                # Add other relevant fields as necessary
            }
        },
        "livemode": False,
        "pending_webhooks": 1,
        "type": "checkout.session.completed"
    }

    payload_json = json.dumps(payload, separators=(',', ':'))

    # Secret for signing the webhook payload - in real scenario, this would be the Stripe webhook secret
    # Here we simulate a valid signing secret as we must test the valid signature scenario
    secret = "whsec_testsecret"

    # Construct the Stripe-Signature header as Stripe sends it
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload_json}"
    signature = hmac.new(
        key=secret.encode(),
        msg=signed_payload.encode(),
        digestmod=hashlib.sha256
    ).hexdigest()
    stripe_signature_header = f"t={timestamp},v1={signature}"

    headers = {
        "Content-Type": "application/json",
        "Stripe-Signature": stripe_signature_header
    }

    try:
        response = requests.post(
            f"{BASE_URL}{WEBHOOK_ENDPOINT}",
            data=payload_json,
            headers=headers,
            timeout=TIMEOUT
        )
    except requests.RequestException as e:
        assert False, f"Request to Stripe webhook failed: {e}"

    # Assert HTTP 200 OK indicating the webhook is acknowledged and processed
    assert response.status_code == 200, f"Expected status code 200, got {response.status_code}"

    # Assert response body contains "Acknowledged" (case-insensitive) or is empty as per typical webhook handling
    # The PRD states 200 "Acknowledged"
    content = response.text.lower()
    assert "acknowledged" in content or content == "", f"Unexpected response body: {response.text}"

test_post_api_stripe_webhook_valid_signature()
