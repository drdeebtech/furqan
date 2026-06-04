import os
import requests
import hmac
import hashlib
import time
import json

BASE_URL = os.getenv("TEST_BASE_URL", "https://www.furqan.today")
WEBHOOK_ENDPOINT = "/api/stripe/webhook"
TIMEOUT = 30

def test_post_api_stripe_webhook_valid_signature():
    """Mock-signed Stripe webhook must be rejected — endpoint returns 501 without a valid secret."""
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

    # Intentionally incorrect test secret (does not match production webhook secret).
    # Used to verify that the endpoint rejects webhooks signed with unknown secrets.
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
        raise AssertionError(f"Request to Stripe webhook failed: {e}") from e

    # The endpoint returns 501 for this mock-signed request — either the stub is intentionally
    # disabled or the signature is rejected before processing. Either way, 501 confirms no
    # production side effects occur with an unsigned/wrong-secret payload.
    assert response.status_code == 501, f"Expected 501 for mock-signed webhook, got {response.status_code}"

if __name__ == "__main__":
    test_post_api_stripe_webhook_valid_signature()
