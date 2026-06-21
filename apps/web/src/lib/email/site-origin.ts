const DEFAULT_EMAIL_ASSET_ORIGIN = "https://communicationcanoe.com";

function isLocalOrigin(origin: URL): boolean {
  const hostname = origin.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.startsWith("127.0.0.1") ||
    hostname === "[::1]"
  );
}

export function resolveSiteOrigin(): URL {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    try {
      if (explicit.startsWith("http://") || explicit.startsWith("https://")) {
        return new URL(explicit);
      }
      return new URL(`https://${explicit}`);
    } catch {
      /* fall through */
    }
  }

  const port = process.env.PORT ?? "3000";
  return new URL(`http://localhost:${port}`);
}

export function resolveEmailAssetOrigin(): URL {
  const override = process.env.EMAIL_ASSET_BASE_URL?.trim();
  if (override) {
    try {
      return override.startsWith("http://") || override.startsWith("https://")
        ? new URL(override)
        : new URL(`https://${override}`);
    } catch {
      /* fall through */
    }
  }

  const siteOrigin = resolveSiteOrigin();
  if (isLocalOrigin(siteOrigin)) {
    return new URL(DEFAULT_EMAIL_ASSET_ORIGIN);
  }

  return siteOrigin;
}

export function absolutePublicAssetPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalized, resolveEmailAssetOrigin()).href;
}

export async function toAbsoluteAppUrl(path: string): Promise<string> {
  const { headers } = await import("next/headers");
  const headersList = await headers();
  const host =
    headersList.get("x-forwarded-host") ||
    headersList.get("host") ||
    "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
  return new URL(path.startsWith("/") ? path : `/${path}`, base).href;
}
