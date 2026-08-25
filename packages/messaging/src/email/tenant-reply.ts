import { withRetry, isRetryableSesError } from "@communication-canoe/shared/retry";
import { sendSesEmail } from "./ses";
import type { TenantMailFrom } from "./from";
import type { FetchedEmailAttachment } from "./attachments";

export type SendTenantReplyEmailOptions = {
  to: string;
  subject: string;
  text: string;
  tenant?: TenantMailFrom | null;
  /** A complete From header value that wins over the tenant's own. Used by
   * reside's notification sends, which carry the building's outbound-only
   * sending identity - see resideSendMessageInputSchema.from. */
  from?: string;
  /** Reply-To, for when `from` is a send-only identity. Without it a resident
   * hitting Reply writes to a mailbox nobody reads. */
  replyTo?: string;
  /** When true, `text` is already HTML (e.g. reside's rendered notification/notice
   * body) and is passed straight to SES rather than escaped and wrapped in a <p>. */
  isHtml?: boolean;
  /** Already-fetched attachment bytes - see fetchEmailAttachments. Presence
   * routes the send through SES's raw-MIME path (sendSesEmail's
   * sendRawSesEmail branch). */
  attachments?: FetchedEmailAttachment[];
};

export type SendTenantReplyEmailResult = {
  messageId?: string;
};

export async function sendTenantReplyEmail(
  options: SendTenantReplyEmailOptions,
): Promise<SendTenantReplyEmailResult> {
  return withRetry(
    () =>
      sendSesEmail({
        to: options.to,
        subject: options.subject,
        html: options.isHtml
          ? options.text
          : `<p>${escapeHtml(options.text).replace(/\n/g, "<br />")}</p>`,
        text: options.isHtml ? undefined : options.text,
        from: options.from,
        replyTo: options.replyTo,
        tenant: options.tenant,
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
        attachments: options.attachments,
      }),
    { isRetryable: isRetryableSesError },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
