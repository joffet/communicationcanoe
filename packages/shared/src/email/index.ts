export interface InboundEmail {
  from: string;
  fromName?: string;
  to: string;
  /**
   * Every address the message was sent to - To, then Cc, then Bcc - for
   * finding the tenant. `to` alone is the first To address, which misses a
   * tenant address a resident put second or in Cc. Parsers that cannot tell
   * leave it unset and callers fall back to `to`.
   */
  recipients?: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  messageId?: string;
}

export interface InboundEmailParser {
  parse(payload: unknown): InboundEmail;
}

export { parsePostmarkInbound } from "./postmark";
export { parseSendGridInbound } from "./sendgrid";
