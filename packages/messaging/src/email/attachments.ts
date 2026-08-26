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

/** reside's own app - the same host comm-canoe already calls back into.
 * Resolved fresh per call rather than cached at module load so tests can set
 * the env var first. */
function resideOrigin(): string | null {
  const base = process.env.RESIDE_API_BASE;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/**
 * The URL to fetch for an attachment, always on reside's own origin.
 *
 * The caller's host is DISCARDED rather than validated. Only the path and
 * query survive, resolved against RESIDE_API_BASE - so a caller cannot point
 * this at anything, and there is no origin left to get wrong.
 *
 * It used to compare origins and refuse a mismatch. That was correct and it
 * worked, which was the problem: reside builds these URLs from BETTER_AUTH_URL
 * (`http://onecardiff.ca`) while comm-canoe is configured with
 * `https://api.resideplatform.co`. Two aliases of one deployment, two
 * different origins, every agreement PDF refused - and silently, because a
 * rejected attachment is dropped so it cannot cost a resident their email.
 * Re-aligning those strings would have left the same trap set for the next
 * host or scheme that drifts.
 *
 * Keeping the path on an expected prefix is defence in depth: this endpoint
 * only ever serves reside's signed attachment route, and reside verifies the
 * signature itself.
 */
const ATTACHMENT_PATH_PREFIX = "/api/reservations/agreement-pdf/";

export function resolveAttachmentUrl(url: string): string | null {
  const origin = resideOrigin();
  if (!origin) return null;
  try {
    // A relative path resolves against the base; an absolute URL has its own
    // origin replaced by it. Either way the result is on reside's origin.
    const supplied = new URL(url, origin);
    if (!supplied.pathname.startsWith(ATTACHMENT_PATH_PREFIX)) return null;
    return `${origin}${supplied.pathname}${supplied.search}`;
  } catch {
    return null;
  }
}

/** Retained for callers that only need the yes/no. */
export function isAllowedAttachmentUrl(url: string): boolean {
  return resolveAttachmentUrl(url) !== null;
}

async function fetchOneAttachment(ref: EmailAttachmentRef): Promise<FetchedEmailAttachment | null> {
  if (ref.contentType !== "application/pdf") {
    console.error(`[email-attachments] rejected non-pdf contentType "${ref.contentType}" for ${ref.filename}`);
    return null;
  }
  const fetchUrl = resolveAttachmentUrl(ref.url);
  if (!fetchUrl) {
    console.error(`[email-attachments] refused attachment URL: ${ref.url}`);
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(fetchUrl, { signal: controller.signal });
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
