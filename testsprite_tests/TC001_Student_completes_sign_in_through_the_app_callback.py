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
        page = await context.new_page()

        # A missing/fake OAuth code must be rejected and redirected to /login with an error.
        # PASS = OAuth callback correctly refuses the invalid code.
        await page.goto("http://localhost:3000/api/auth/callback/google")
        await page.wait_for_load_state("domcontentloaded")

        current_url = await page.evaluate("() => window.location.href")
        assert "/login" in current_url, (
            f"Expected redirect to /login after invalid OAuth code, got: {current_url}"
        )

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
