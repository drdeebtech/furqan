import asyncio
from playwright import async_api

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        pw = await async_api.async_playwright().start()
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process",
            ],
        )
        context = await browser.new_context()
        context.set_default_timeout(15000)

        # GET /api/bookings is an intentional 501 stub — no login required.
        # The endpoint is deliberately unimplemented; 501 is the expected PASS outcome.
        response = await context.request.get("http://localhost:3000/api/bookings")
        assert response.status == 501, (
            f"Expected /api/bookings to return 501 (intentional stub), got: {response.status}"
        )

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
