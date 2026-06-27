import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const BUNNY_KEYS = [
  "BUNNY_STORAGE_ZONE_NAME",
  "BUNNY_STORAGE_API_KEY",
  "BUNNY_STORAGE_HOSTNAME",
  "BUNNY_STORAGE_REGION_ENDPOINT",
] as const;

// Snapshot any preexisting Bunny env so the suite restores (not clobbers) it.
function snapshotBunnyEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of BUNNY_KEYS) snap[k] = process.env[k];
  return snap;
}
function restoreBunnyEnv(snap: Record<string, string | undefined>): void {
  for (const k of BUNNY_KEYS) {
    const v = snap[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("isBunnyStorageConfigured", () => {
  const VARS = {
    BUNNY_STORAGE_ZONE_NAME: "zone",
    BUNNY_STORAGE_API_KEY: "key",
    BUNNY_STORAGE_HOSTNAME: "cdn.example.com",
    BUNNY_STORAGE_REGION_ENDPOINT: "storage.bunnycdn.com",
  };
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    vi.resetModules();
    saved = snapshotBunnyEnv();
    for (const k of BUNNY_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreBunnyEnv(saved);
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
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    vi.resetModules();
    saved = snapshotBunnyEnv();
    Object.assign(process.env, VARS);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreBunnyEnv(saved);
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

  it("throws a timeout error when the upload aborts", async () => {
    const mockFetch = vi.mocked(fetch);
    // Simulate fetch rejecting with an AbortError (what AbortController triggers)
    mockFetch.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );

    const { putStorageObject } = await import("./storage");
    await expect(
      putStorageObject("certificates/abc.pdf", Buffer.from("data"), "application/pdf", 5),
    ).rejects.toThrow("Bunny Storage PUT timed out after 5ms");
  });
});
