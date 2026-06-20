import type { InboundEmail, InboundEmailParser } from "./index";

/** Stub for future SendGrid inbound parse adapter. */
export function parseSendGridInbound(payload: unknown): InboundEmail {
  const data = payload as {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  };

  return {
    from: data.from ?? "",
    to: data.to ?? "",
    subject: data.subject ?? "(no subject)",
    textBody: data.text ?? data.html?.replace(/<[^>]+>/g, " ") ?? "",
    htmlBody: data.html,
  };
}

export const sendGridParser: InboundEmailParser = {
  parse: parseSendGridInbound,
};
