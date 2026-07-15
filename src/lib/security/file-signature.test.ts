import { describe, expect, it } from "vitest";
import { assertAllowedUpload, detectFileType } from "./file-signature";

function fileFromBytes(bytes: readonly number[], name: string, type = "application/octet-stream"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("detectFileType", () => {
  it("detects real PNG bytes", async () => {
    const file = fileFromBytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00],
      "image.png",
      "image/png",
    );

    await expect(detectFileType(file)).resolves.toBe("png");
  });

  it("returns null for RIFF without the WEBP marker", async () => {
    const file = fileFromBytes(
      [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45],
      "audio.webp",
      "image/webp",
    );

    await expect(detectFileType(file)).resolves.toBeNull();
  });
});

describe("assertAllowedUpload", () => {
  it("rejects SVG bytes disguised as a PNG", async () => {
    const svgBytes = Array.from(new TextEncoder().encode(`<svg><script>alert(1)</script></svg>`));
    const file = fileFromBytes(svgBytes, "evil.png", "image/png");

    await expect(assertAllowedUpload(file, ["png"])).rejects.toThrow(
      "Unsupported or unsafe file type",
    );
  });

  it("rejects HTML bytes disguised as a PNG", async () => {
    const htmlBytes = Array.from(new TextEncoder().encode(`<!doctype html><script>alert(1)</script>`));
    const file = fileFromBytes(htmlBytes, "evil.png", "image/png");

    await expect(assertAllowedUpload(file, ["png"])).rejects.toThrow(
      "Unsupported or unsafe file type",
    );
  });

  it("rejects a real JPEG when only PNG is allowed", async () => {
    const file = fileFromBytes([0xff, 0xd8, 0xff, 0xe0, 0x00], "photo.jpg", "image/jpeg");

    await expect(assertAllowedUpload(file, ["png"])).rejects.toThrow(
      "Unsupported or unsafe file type",
    );
  });
});
