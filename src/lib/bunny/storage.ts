import "server-only";

// Bunny Edge Storage client — server-only.
// Separate from src/lib/bunny/client.ts which handles Bunny Stream (video).
//
// PUT https://<regionEndpoint>/<zoneName>/<path>  AccessKey header auth.
// Public URL served via pull-zone: https://<hostname>/<path>
//
// Required env vars (never NEXT_PUBLIC_*):
//   BUNNY_STORAGE_ZONE_NAME      — storage zone name
//   BUNNY_STORAGE_API_KEY        — storage zone password / API key
//   BUNNY_STORAGE_HOSTNAME       — pull-zone hostname for public URLs
//   BUNNY_STORAGE_REGION_ENDPOINT — regional upload endpoint, e.g. uk.storage.bunnycdn.com

interface StorageConfig {
  zoneName: string;
  apiKey: string;
  hostname: string;
  regionEndpoint: string;
}

function getStorageConfig(): StorageConfig {
  const zoneName = process.env.BUNNY_STORAGE_ZONE_NAME;
  const apiKey = process.env.BUNNY_STORAGE_API_KEY;
  const hostname = process.env.BUNNY_STORAGE_HOSTNAME;
  const regionEndpoint = process.env.BUNNY_STORAGE_REGION_ENDPOINT;

  if (!zoneName || !apiKey || !hostname || !regionEndpoint) {
    throw new Error(
      "Bunny Edge Storage is not configured. Set BUNNY_STORAGE_ZONE_NAME, " +
        "BUNNY_STORAGE_API_KEY, BUNNY_STORAGE_HOSTNAME, " +
        "BUNNY_STORAGE_REGION_ENDPOINT in .env.local.",
    );
  }

  return { zoneName, apiKey, hostname, regionEndpoint };
}

/** Returns true only when all four required env vars are present. */
export function isBunnyStorageConfigured(): boolean {
  return Boolean(
    process.env.BUNNY_STORAGE_ZONE_NAME &&
      process.env.BUNNY_STORAGE_API_KEY &&
      process.env.BUNNY_STORAGE_HOSTNAME &&
      process.env.BUNNY_STORAGE_REGION_ENDPOINT,
  );
}

/**
 * Upload a Buffer to Bunny Edge Storage.
 *
 * @param remotePath  path inside the storage zone, e.g. "certificates/abc.pdf"
 * @param buffer      file bytes
 * @param contentType MIME type (default application/pdf)
 * @returns public CDN URL
 * @throws  on any non-2xx response — caller must not persist a bad pdf_url
 */
export async function putStorageObject(
  remotePath: string,
  buffer: Buffer,
  contentType = "application/pdf",
): Promise<string> {
  const cfg = getStorageConfig();
  const url = `https://${cfg.regionEndpoint}/${cfg.zoneName}/${remotePath}`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: cfg.apiKey,
      "Content-Type": contentType,
    },
    body: buffer as unknown as BodyInit,
  });

  if (!res.ok) {
    throw new Error(`Bunny Storage PUT failed: ${res.status} ${await res.text()}`);
  }

  return `https://${cfg.hostname}/${remotePath}`;
}
