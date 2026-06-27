import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Mock puppeteer-core browser/page chain
const mockPagePdf = vi.fn();
const mockPageSetContent = vi.fn();
const mockPageEvaluate = vi.fn();
const mockBrowserClose = vi.fn();
const mockBrowserNewPage = vi.fn();
const mockPuppeteerLaunch = vi.fn();

vi.mock("puppeteer-core", () => ({
  default: { launch: mockPuppeteerLaunch },
}));

// Mock @sparticuz/chromium
vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: ["--no-sandbox"],
    executablePath: vi.fn().mockResolvedValue("/usr/bin/chromium"),
    headless: true,
  },
}));

// Mock logger (logError may be called for missing font — non-fatal)
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));

// Mock QRCode
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,abc") },
}));

// Mock fs so font loading is deterministic (simulates font present)
vi.mock("node:fs", () => ({
  default: {
    readFileSync: vi.fn().mockReturnValue(Buffer.from("fake-font-bytes")),
  },
}));

import { renderCertificatePdf } from "./pdf";
import type { PublicCertificate } from "./view";

const MOCK_CERT: PublicCertificate = {
  id: "cert-id-1",
  public_slug: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  certificate_type: "appreciation_juz",
  milestone_key: "1",
  cited_range_start: "1:1",
  cited_range_end: "2:141",
  cited_start_surah_ar: "الفاتحة",
  cited_end_surah_ar: "البقرة",
  display_name: "محمد أحمد",
  issued_at: "2026-06-27T00:00:00Z",
  pdf_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();

  // Wire mock page
  const mockPage = {
    setContent: mockPageSetContent.mockResolvedValue(undefined),
    evaluate: mockPageEvaluate.mockResolvedValue(undefined),
    pdf: mockPagePdf.mockResolvedValue(Buffer.from("%PDF-1.4 mock-pdf-content")),
  };
  mockBrowserNewPage.mockResolvedValue(mockPage);
  mockBrowserClose.mockResolvedValue(undefined);
  mockPuppeteerLaunch.mockResolvedValue({
    newPage: mockBrowserNewPage,
    close: mockBrowserClose,
  });
});

describe("renderCertificatePdf", () => {
  it("returns a Buffer starting with %PDF", async () => {
    const buf = await renderCertificatePdf(MOCK_CERT);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
  });

  it("calls page.setContent with dir=rtl and lang=ar", async () => {
    await renderCertificatePdf(MOCK_CERT);
    expect(mockPageSetContent).toHaveBeenCalledOnce();
    const [html] = mockPageSetContent.mock.calls[0] as [string, unknown];
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
  });

  it("waits for document.fonts.ready before calling pdf()", async () => {
    const order: string[] = [];
    mockPageEvaluate.mockImplementation(async () => {
      order.push("fonts");
    });
    mockPagePdf.mockImplementation(async () => {
      order.push("pdf");
      return Buffer.from("%PDF-1.4");
    });

    await renderCertificatePdf(MOCK_CERT);
    expect(order).toEqual(["fonts", "pdf"]);
  });

  it("closes the browser even if page.pdf throws", async () => {
    mockPagePdf.mockRejectedValue(new Error("render error"));
    await expect(renderCertificatePdf(MOCK_CERT)).rejects.toThrow("render error");
    expect(mockBrowserClose).toHaveBeenCalledOnce();
  });

  it("embeds Arabic font when font file is available", async () => {
    await renderCertificatePdf(MOCK_CERT);
    const [html] = mockPageSetContent.mock.calls[0] as [string, unknown];
    // base64 of "fake-font-bytes"
    expect(html).toContain("@font-face");
    expect(html).toContain("data:font/truetype;base64,");
  });
});
