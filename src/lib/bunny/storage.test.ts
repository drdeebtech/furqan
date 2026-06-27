import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Tests run before import so env is clean per test
describe("isBunnyStorageConfigured", () => {
  const VARS = {
    BUNNY_STORAGE_ZONE_NAME: "zone",
    BUNNY_STORAGE_API_KEY: "key",
    BUNNY_STORAGE_HOSTNAME: "cdn.example.com",
    BUNNY_STORAGE_REGION_ENDPOINT: "storage.bunnycdn.com",
  };

  beforeEach(() => {
    vi.resetModules();
    for (const k of Object.keys(VARS)) delete process.env[k];
  });

  afterEach(() => {
    for (const k of Object.keys(VARS)) delete process.env[k];
  });

  it("returns false when no env vars set", async () => {
    const { isBunnyStorageConfigured } = await import("./storage");
    expect(isBunnyStorageConfigured()).toBe(false);
  });

  it("returns false when only some env vars set", async () => {
    process.env.BUNNY_STORAGE_ZONE_NAME = "zone";
    const { isBunnyStorageConfigured } = await import("./storage");
    expect(isBunnyStorageConfigured()).toBe(false);
  });

  it("returns true when all four env vars are set", async () => {
    Object.assign(process.env, VARS);
    const { isBunnyStorageConfigured } = await import("./storage");
    expect(isBunnyStorageConfigured()).toBe(true);
  });
});

describe("putStorageObject", () => {
  const VARS = {
    BUNNY_STORAGE_ZONE_NAME: "myzone",
    BUNNY_STORAGE_API_KEY: "secret",
    BUNNY_STORAGE_HOSTNAME: "cdn.example.com",
    BUNNY_STORAGE_REGION_ENDPOINT: "storage.bunnycdn.com",
  };

  beforeEach(() => {
    vi.resetModules();
    Object.assign(process.env, VARS);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(VARS)) delete process.env[k];
  });

  it("PUTs to the correct URL and returns public CDN URL on success", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response("", { status: 201 }));

    const { putStorageObject } = await import("./storage");
    const buf = Buffer.from("%PDF-1.4");
    const url = await putStorageObject("certificates/abc.pdf", buf);

    expect(url).toBe("https://cdn.example.com/certificates/abc.pdf");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://storage.bunnycdn.com/myzone/certificates/abc.pdf",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ AccessKey: "secret" }),
      }),
    );
  });

  it("throws on non-2xx response", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    const { putStorageObject } = await import("./storage");
    await expect(
      putStorageObject("certificates/abc.pdf", Buffer.from("data")),
    ).rejects.toThrow("Bunny Storage PUT failed: 401");
  });

  it("throws when env vars are missing", async () => {
    for (const k of Object.keys(VARS)) delete process.env[k];
    const { putStorageObject } = await import("./storage");
    await expect(
      putStorageObject("certificates/abc.pdf", Buffer.from("data")),
    ).rejects.toThrow("Bunny Edge Storage is not configured");
  });
});
