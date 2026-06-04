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

        # Step 1: Log in as student
        await page.goto("http://localhost:3000/login")
        await page.wait_for_load_state("domcontentloaded")

        await page.locator("input[name='email']").fill("test-student@furqan.test")
        await page.locator("input[name='password']").fill(
            os.environ.get("TEST_STUDENT_PASSWORD", "")
        )
        await page.locator("form button").click()
        await page.wait_for_function(
            "() => !window.location.href.includes('/login')", timeout=15000
        )

        # Step 2: Log out — the logout form POSTs to /api/auth/logout and redirects to /login
        await page.locator("form[action='/api/auth/logout'] button").click()
        await page.wait_for_function(
            "() => window.location.href.includes('/login')", timeout=15000
        )

        current_url = await page.evaluate("() => window.location.href")
        assert "/login" in current_url, (
            f"Expected /login after logout, but got: {current_url}"
        )

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
