import { withRetry, isRetryableSesError } from "@communication-canoe/shared/retry";
import { sendSesEmail } from "./ses";
import type { TenantMailFrom } from "./from";

export type SendTenantReplyEmailOptions = {
  to: string;
  subject: string;
  text: string;
  tenant?: TenantMailFrom | null;
  /** When true, `text` is already HTML (e.g. reside's rendered notification/notice
   * body) and is passed straight to SES rather than escaped and wrapped in a <p>. */
  isHtml?: boolean;
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
        tenant: options.tenant,
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
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
