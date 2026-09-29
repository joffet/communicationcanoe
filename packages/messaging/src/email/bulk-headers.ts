import { sesMessageIdHeader } from "./ses";

/**
 * The per-recipient headers of a bulk email, or undefined when there are none
 * (undefined keeps the send on the plain SES path - any header at all forces
 * the raw-MIME one).
 *
 * `referencedProviderMessageId` is the SES MessageId of the recipient's copy
 * of the notice being followed up. Both In-Reply-To and References carry it:
 * with a single ancestor that is what threading clients expect, and Gmail in
 * particular threads on References.
 */
export function buildBulkEmailHeaders(opts: {
  unsubscribeUrl?: string | null;
  referencedProviderMessageId?: string | null;
  region?: string;
}): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (opts.unsubscribeUrl) {
    // Angle brackets are required by RFC 2369; a bare URL here is dropped by
    // every client that parses the field, which looks exactly like not
    // sending it.
    headers["List-Unsubscribe"] = `<${opts.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (opts.referencedProviderMessageId) {
    const messageId = sesMessageIdHeader(opts.referencedProviderMessageId, opts.region);
    headers["In-Reply-To"] = messageId;
    headers["References"] = messageId;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
