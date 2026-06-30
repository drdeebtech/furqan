import { test, expect } from "@playwright/test";

/**
 * E2E — spec 035 US1 (SC-001, INV-1/2/4): the public /teachers page must never
 * render a test/seed/placeholder teacher. This is the exact defect the
 * seven-persona review found in production ("Test Teacher", "E2E Test Teacher
 * (DELETE ME)").
 *
 * The data invariants (a flagged teacher is excluded by the gate, the test
 * accounts' teacher_profiles are archived) are proven at the data layer in
 * src/app/(public)/teachers/__tests__/get-public-teachers.test.ts. This spec
 * is the rendered-page guard: it loads the real page and asserts none of the
 * known test markers survive to the DOM, and that a zero-session teacher is
 * shown as "New", never as a bare "0 completed sessions".
 *
 * Public page — no auth needed. Runs against the Playwright baseURL; the
 * harness provides the server (see playwright.config).
 */
test.describe("public /teachers — no test accounts", () => {
  test("renders no test/placeholder teacher and no bare 0-session counter", async ({ page }) => {
    await page.goto("/teachers");
    await expect(page.locator("h1")).toBeVisible();

    const body = page.locator("body");
    // INV-1/2/4: the production leak markers must never appear.
    await expect(body).not.toContainText("Test Teacher");
    await expect(body).not.toContainText("DELETE ME");
    await expect(body).not.toContainText("@furqan.test");

    // INV-5 / FR-006: a teacher with no completed sessions is shown as "New",
    // not the bare "0 جلسة مكتملة" / "0 completed sessions" the review flagged.
    await expect(body).not.toContainText("0 جلسة مكتملة");
    await expect(body).not.toContainText("0 completed sessions");
  });
});
