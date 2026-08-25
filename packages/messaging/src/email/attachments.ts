// Resolves a reside-supplied attachment reference (filename/contentType/url)
// into the actual bytes to MIME-attach - see ses.ts's SendRawEmailCommand
// path. reside deliberately does not push attachment BYTES through the send
// endpoint: pushing bytes would bloat the durable outbox row (reside's
// commCanoeOutbox) that a failed send is replayed from, and a retry would
// resend a stale copy of the file instead of the current one. A URL keeps
// that row small and makes a retry re-fetch.
//
// Fetching a caller-supplied URL server-side is an SSRF surface, so this is
// deliberately restrictive: only reside's own host (RESIDE_API_BASE - the
// same env var comm-canoe already uses to call back into reside, see
// notify-activity.ts/identity-status-client.ts) may be fetched from, only
// application/pdf is accepted, and both per-file and total size are capped.
// A rejected or failed attachment is dropped, logged, and does NOT fail the
// send - the email matters more than the attachment.

export type EmailAttachmentRef = {
  filename: string;
  contentType: "application/pdf";
  url: string;
};

export type FetchedEmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

/** Matches resideSendMessageInputSchema's attachments array bound. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

/** Per-file cap. Generous relative to a rendered agreement PDF (typically a
 * few hundred KB), conservative relative to SES's ~10MB raw-message limit. */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Combined cap across every attachment on one message, leaving headroom
 * under SES's raw-message size limit for the HTML body and MIME overhead. */
const MAX_TOTAL_ATTACHMENT_BYTES = 9 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 15_000;

/** The one origin attachment URLs may be fetched from - reside's own app, the
 * same host comm-canoe already calls back into. Resolved fresh per call
 * rather than cached at module load so tests can set the env var first. */
function allowedAttachmentOrigin(): string | null {
  const base = process.env.RESIDE_API_BASE;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function isAllowedAttachmentUrl(url: string): boolean {
  const allowedOrigin = allowedAttachmentOrigin();
  if (!allowedOrigin) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
}

async function fetchOneAttachment(ref: EmailAttachmentRef): Promise<FetchedEmailAttachment | null> {
  if (ref.contentType !== "application/pdf") {
    console.error(`[email-attachments] rejected non-pdf contentType "${ref.contentType}" for ${ref.filename}`);
    return null;
  }
  if (!isAllowedAttachmentUrl(ref.url)) {
    console.error(`[email-attachments] rejected attachment URL outside the allowed origin: ${ref.url}`);
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(ref.url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[email-attachments] fetch failed (${response.status}) for ${ref.url}`);
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
      console.error(`[email-attachments] attachment too large per Content-Length: ${ref.url}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_ATTACHMENT_BYTES) {
      console.error(`[email-attachments] attachment too large (${arrayBuffer.byteLength} bytes): ${ref.url}`);
      return null;
    }

    return {
      filename: ref.filename,
      contentType: ref.contentType,
      content: Buffer.from(arrayBuffer),
    };
  } catch (err) {
    console.error(`[email-attachments] fetch threw for ${ref.url}:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches every attachment reference, dropping (with a logged reason) any
 * that fail validation, fail to fetch, or would push the combined total over
 * budget. Never throws - a bad attachment must not fail the email it rides
 * along on.
 */
export async function fetchEmailAttachments(
  refs: EmailAttachmentRef[] | undefined,
): Promise<FetchedEmailAttachment[]> {
  if (!refs || refs.length === 0) return [];

  const capped = refs.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const fetched: FetchedEmailAttachment[] = [];
  let totalBytes = 0;

  for (const ref of capped) {
    const attachment = await fetchOneAttachment(ref);
    if (!attachment) continue;
    if (totalBytes + attachment.content.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
      console.error(
        `[email-attachments] dropping ${ref.filename} - combined attachment size would exceed the ${MAX_TOTAL_ATTACHMENT_BYTES}-byte budget`,
      );
      continue;
    }
    totalBytes += attachment.content.byteLength;
    fetched.push(attachment);
  }

  return fetched;
}
