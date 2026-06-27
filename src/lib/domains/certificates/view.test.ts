import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only so the import doesn't throw in vitest (no Next.js runtime)
vi.mock("server-only", () => ({}));

// Mock Supabase admin client
const mockMaybeSingle = vi.fn();
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle, eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

import { getPublicCertificate } from "./view";

const SLUG = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const BASE_CERT = {
  id: "cert-id-1",
  public_slug: SLUG,
  certificate_type: "appreciation_juz",
  milestone_key: "1",
  cited_range_start: "1:1",  // Al-Fatiha
  cited_range_end: "2:141",  // Al-Baqarah
  issued_at: "2026-06-27T00:00:00Z",
  pdf_url: null,
  student_id: "student-id-1",
};

const BASE_PROFILE = {
  full_name_ar: "محمد أحمد",
  full_name: "Mohammed Ahmed",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPublicCertificate", () => {
  it("returns null when cert not found", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await getPublicCertificate(SLUG);
    expect(result).toBeNull();
  });

  it("returns null on cert query error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: new Error("db error"),
    });
    const result = await getPublicCertificate(SLUG);
    expect(result).toBeNull();
  });

  it("maps cert data with Arabic surah names", async () => {
    // First call: cert query; second call: profile query
    mockMaybeSingle
      .mockResolvedValueOnce({ data: BASE_CERT, error: null })
      .mockResolvedValueOnce({ data: BASE_PROFILE, error: null });

    const result = await getPublicCertificate(SLUG);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("cert-id-1");
    expect(result!.public_slug).toBe(SLUG);
    // surahName(1, "ar") = "الفاتحة"
    expect(result!.cited_start_surah_ar).toBe("الفاتحة");
    // surahName(2, "ar") = "البقرة"
    expect(result!.cited_end_surah_ar).toBe("البقرة");
    expect(result!.display_name).toBe("محمد أحمد");
    expect(result!.pdf_url).toBeNull();
  });

  it("falls back to full_name when full_name_ar is null", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: BASE_CERT, error: null })
      .mockResolvedValueOnce({
        data: { full_name_ar: null, full_name: "Mohammed Ahmed" },
        error: null,
      });

    const result = await getPublicCertificate(SLUG);
    expect(result!.display_name).toBe("Mohammed Ahmed");
  });

  it("sets display_name to null when profile query fails", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: BASE_CERT, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const result = await getPublicCertificate(SLUG);
    expect(result!.display_name).toBeNull();
  });

  it("returns cited_start_surah_ar null for out-of-range surah number", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: {
          ...BASE_CERT,
          cited_range_start: "200:1",  // invalid surah > 114
          cited_range_end: "200:2",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: BASE_PROFILE, error: null });

    const result = await getPublicCertificate(SLUG);
    expect(result!.cited_start_surah_ar).toBeNull();
    expect(result!.cited_end_surah_ar).toBeNull();
  });

  it("NEVER returns PII fields (email, phone, dob, address)", async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: BASE_CERT, error: null })
      .mockResolvedValueOnce({ data: BASE_PROFILE, error: null });

    const result = await getPublicCertificate(SLUG);
    expect(result).not.toBeNull();

    const keys = Object.keys(result!);
    const bannedFields = ["email", "phone", "dob", "date_of_birth", "address", "student_id"];
    for (const field of bannedFields) {
      expect(keys).not.toContain(field);
    }
  });

  it("includes pdf_url when present", async () => {
    const pdfUrl = "https://cdn.example.com/certificates/abc.pdf";
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { ...BASE_CERT, pdf_url: pdfUrl }, error: null })
      .mockResolvedValueOnce({ data: BASE_PROFILE, error: null });

    const result = await getPublicCertificate(SLUG);
    expect(result!.pdf_url).toBe(pdfUrl);
  });
});
