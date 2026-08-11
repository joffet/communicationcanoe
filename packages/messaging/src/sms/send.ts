import { withRetry, isRetryableTwilioError } from "@communication-canoe/shared/retry";
import { getTwilioClient } from "./twilio-client";

export type SendSmsOptions = {
  to: string;
  from: string;
  body: string;
};

export type SendSmsResult = {
  sid: string;
};

function statusCallbackUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/status`
    : undefined;
}

export async function sendSms(options: SendSmsOptions): Promise<SendSmsResult> {
  const message = await withRetry(
    () =>
      getTwilioClient().messages.create({
        to: options.to,
        from: options.from,
        body: options.body,
        statusCallback: statusCallbackUrl(),
      }),
    { isRetryable: isRetryableTwilioError },
  );

  return { sid: message.sid };
}
