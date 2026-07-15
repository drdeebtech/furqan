export type AllowedFileType = "jpeg" | "png" | "webp" | "gif" | "pdf";

export const MIME_BY_TYPE: Record<AllowedFileType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

export const EXT_BY_TYPE: Record<AllowedFileType, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
  pdf: "pdf",
};

const bytesMatch = (bytes: Uint8Array, expected: readonly number[], offset = 0): boolean =>
  expected.every((byte, index) => bytes[offset + index] === byte);

export async function detectFileType(file: File): Promise<AllowedFileType | null> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  if (bytesMatch(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (bytesMatch(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (bytesMatch(bytes, [0x52, 0x49, 0x46, 0x46]) && bytesMatch(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (bytesMatch(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";

  return null;
}

export async function assertAllowedUpload(
  file: File,
  allow: readonly AllowedFileType[],
): Promise<{ type: AllowedFileType; contentType: string; ext: string }> {
  const type = await detectFileType(file);
  if (!type || !allow.includes(type)) {
    throw new Error("Unsupported or unsafe file type");
  }

  return {
    type,
    contentType: MIME_BY_TYPE[type],
    ext: EXT_BY_TYPE[type],
  };
}
