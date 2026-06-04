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

        # Step 1: Log in as teacher
        await page.goto("http://localhost:3000/login")
        await page.wait_for_load_state("domcontentloaded")

        await page.locator("input[name='email']").fill("test-teacher@furqan.test")
        await page.locator("input[name='password']").fill(
            os.environ.get("TEST_TEACHER_PASSWORD", "")
        )
        await page.locator("form button").click()
        await page.wait_for_function(
            "() => window.location.href.includes('/teacher')", timeout=15000
        )

        # Step 2: Verify teacher dashboard renders with bookings section
        await page.wait_for_load_state("domcontentloaded")
        current_url = await page.evaluate("() => window.location.href")
        assert "/teacher" in current_url, (
            f"Expected teacher area URL, got: {current_url}"
        )

        bookings_visible = await page.locator(
            "xpath=//*[contains(., 'الحجوزات')]"
        ).first.is_visible()
        assert bookings_visible, (
            "Expected teacher dashboard to display the bookings section (الحجوزات)"
        )

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
