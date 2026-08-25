export { sendSms } from "./sms/send";
export type { SendSmsOptions, SendSmsResult } from "./sms/send";
export { getTwilioClient } from "./sms/twilio-client";

export { DEFAULT_MAIL_FROM, resolveMailFrom, type TenantMailFrom } from "./email/from";
export { sendSesEmail } from "./email/ses";
export { sendTenantReplyEmail } from "./email/tenant-reply";
export type { SendTenantReplyEmailOptions, SendTenantReplyEmailResult } from "./email/tenant-reply";
export { createEmailOpenToken, verifyEmailOpenToken } from "./email/open-tracking-token";
export type { EmailOpenTokenPayload } from "./email/open-tracking-token";
export {
  createEmailClickToken,
  verifyEmailClickToken,
  readEmailClickToken,
  isRedirectableUrl,
} from "./email/click-tracking-token";
export type {
  EmailClickTokenPayload,
  EmailClickTokenReading,
} from "./email/click-tracking-token";
export { withClickTracking } from "./email/click-tracking";

export { dispatchOutboundMessage } from "./dispatch-message";
