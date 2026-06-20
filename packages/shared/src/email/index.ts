export interface InboundEmail {
  from: string;
  fromName?: string;
  to: string;
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
