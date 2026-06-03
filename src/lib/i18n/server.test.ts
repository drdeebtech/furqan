import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet } = vi.hoisted(() => {
  const mockGet = vi.fn<(key: string) => { value: string } | undefined>();
  return { mockGet };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: mockGet }),
}));

import { getT } from "./server";

describe("getT", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  describe("missing cookie", () => {
    beforeEach(() => {
      mockGet.mockReturnValue(undefined);
    });

    it("defaults lang to 'ar'", async () => {
      const { lang } = await getT();
      expect(lang).toBe("ar");
    });

    it("defaults dir to 'rtl'", async () => {
      const { dir } = await getT();
      expect(dir).toBe("rtl");
    });

    it("t() returns Arabic string", async () => {
      const { t } = await getT();
      expect(t("مرحبا", "Hello")).toBe("مرحبا");
    });
  });

  describe("cookie value 'en'", () => {
    beforeEach(() => {
      mockGet.mockReturnValue({ value: "en" });
    });

    it("sets lang to 'en'", async () => {
      const { lang } = await getT();
      expect(lang).toBe("en");
    });

    it("sets dir to 'ltr'", async () => {
      const { dir } = await getT();
      expect(dir).toBe("ltr");
    });

    it("t() returns English string", async () => {
      const { t } = await getT();
      expect(t("مرحبا", "Hello")).toBe("Hello");
    });
  });

  describe("cookie value 'ar' (explicit)", () => {
    it("sets lang to 'ar'", async () => {
      mockGet.mockReturnValue({ value: "ar" });
      const { lang } = await getT();
      expect(lang).toBe("ar");
    });
  });

  describe("cookie value 'fr' (unknown)", () => {
    it("falls back to lang 'ar'", async () => {
      mockGet.mockReturnValue({ value: "fr" });
      const { lang } = await getT();
      expect(lang).toBe("ar");
    });
  });
});
