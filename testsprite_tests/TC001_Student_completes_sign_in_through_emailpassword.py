import asyncio
import os
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

        # Navigate directly to production login
        await page.goto("https://www.furqan.today/login")
        await page.wait_for_load_state("domcontentloaded")

        # Fill credentials
        await page.locator("input[name='email']").fill("test-student@furqan.test")
        await page.locator("input[name='password']").fill(
            os.environ.get("TEST_STUDENT_PASSWORD", "")
        )

        # Submit and wait for navigation away from /login
        await page.locator("form button").click()
        await page.wait_for_function(
            "() => !window.location.href.includes('/login')", timeout=15000
        )

        current_url = await page.evaluate("() => window.location.href")
        assert "/login" not in current_url, (
            f"Expected to leave /login after student sign-in, but still at: {current_url}"
        )

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
