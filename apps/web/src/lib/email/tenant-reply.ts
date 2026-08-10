import { withRetry, isRetryableSesError } from "@communication-canoe/shared/retry";
import { sendSesEmail } from "./ses";
import type { TenantMailFrom } from "./from";

export type SendTenantReplyEmailOptions = {
  to: string;
  subject: string;
  text: string;
  tenant?: TenantMailFrom | null;
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
        html: `<p>${escapeHtml(options.text).replace(/\n/g, "<br />")}</p>`,
        text: options.text,
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
