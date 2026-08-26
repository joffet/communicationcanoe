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

/** Slack on the expiry check below, to absorb clock drift between this
 * service and reside's. Only this side's check is skipped early; reside still
 * enforces the real deadline, so being generous here costs a wasted 404 at
 * worst and never lets a lapsed link through. */
const SIGNATURE_CLOCK_SKEW_SECONDS = 60;

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

/**
 * How long ago this URL's signature lapsed, or null if it has not (or if the
 * URL carries no deadline to read).
 *
 * reside signs these links with a 30-minute HMAC and puts the deadline in
 * `exp`, unix seconds - see its lib/reservations/agreementPdfUrl.ts. Reading
 * `exp` needs no secret, and reading it is worth doing: reside's route
 * answers 404 identically for a bad key, a forged signature and a merely
 * lapsed one, so without this a batch that outlived its signatures looks
 * exactly like a misconfigured path. It is a DIAGNOSTIC, not a second gate -
 * reside owns the verification, and a URL with no `exp` is passed straight
 * through rather than refused.
 *
 * This matters for the bulk path specifically: a single send resolves inside
 * the same request that minted the URL, a batch is drained later. See the
 * per-batch fetch in the outbound-batch worker for what keeps that gap from
 * growing with recipient count.
 */
export function attachmentSignatureExpiredSecondsAgo(
  url: string,
  nowMs: number = Date.now(),
): number | null {
  let exp: string | null;
  try {
    exp = new URL(url).searchParams.get("exp");
  } catch {
    return null;
  }
  if (!exp) return null;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt)) return null;

  const lapsedFor = Math.floor(nowMs / 1000) - expiresAt;
  return lapsedFor > SIGNATURE_CLOCK_SKEW_SECONDS ? lapsedFor : null;
}

/**
 * Memoises fetched bytes by resolved URL, so one file referenced by many
 * messages is fetched once. Owned and scoped by the CALLER rather than being
 * a module-level cache: the outbound-batch worker wants one per drain pass
 * (hundreds of recipients, one PDF), and a process-lifetime cache holding
 * megabytes of a resident's personal document is not something to leave
 * running by default. The single-send path passes none and behaves exactly as
 * it did.
 *
 * The PROMISE is cached, not the result - with several recipients dispatching
 * at once, caching the resolved value lets every one of them miss and fetch
 * before the first finishes writing it back. A dropped attachment (null) is
 * cached too: a refused URL refused once is refused for the whole pass, and
 * re-asking reside several hundred times would only turn one problem into a
 * second one.
 */
export type AttachmentFetchCache = Map<string, Promise<FetchedEmailAttachment | null>>;

export function createAttachmentFetchCache(): AttachmentFetchCache {
  return new Map();
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

  const lapsedFor = attachmentSignatureExpiredSecondsAgo(fetchUrl);
  if (lapsedFor !== null) {
    console.error(
      `[email-attachments] signature for ${ref.filename} lapsed ${lapsedFor}s ago - reside mints these for 30 minutes at POST time, so this send is running long after the request that queued it. Dropping the attachment; the email still goes.`,
    );
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
  /** Optional, caller-owned memo - see AttachmentFetchCache. The size budget
   * below is still applied per message, since the cap is on what one email
   * may carry, not on what was fetched. */
  cache?: AttachmentFetchCache,
): Promise<FetchedEmailAttachment[]> {
  if (!refs || refs.length === 0) return [];

  const capped = refs.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const fetched: FetchedEmailAttachment[] = [];
  let totalBytes = 0;

  for (const ref of capped) {
    const attachment = await fetchOneAttachmentCached(ref, cache);
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

async function fetchOneAttachmentCached(
  ref: EmailAttachmentRef,
  cache: AttachmentFetchCache | undefined,
): Promise<FetchedEmailAttachment | null> {
  if (!cache) return fetchOneAttachment(ref);

  // Keyed by the RESOLVED URL, not the caller's: resolveAttachmentUrl is what
  // decides which bytes are actually fetched, and two callers naming the same
  // file on different hosts are one fetch. A ref that resolves to null is not
  // cacheable by URL, so it falls through and is refused again - cheap, since
  // refusing it never touches the network.
  const key = resolveAttachmentUrl(ref.url);
  if (!key) return fetchOneAttachment(ref);

  let pending = cache.get(key);
  if (!pending) {
    pending = fetchOneAttachment(ref);
    cache.set(key, pending);
  }

  const hit = await pending;
  if (!hit) return null;
  // The bytes are shared; the filename is this ref's own. Same URL under a
  // different display name is one fetch, two attachments.
  return hit.filename === ref.filename ? hit : { ...hit, filename: ref.filename };
}
