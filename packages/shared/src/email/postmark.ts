import type { InboundEmail, InboundEmailParser } from "./index";

interface PostmarkInboundPayload {
  FromFull?: { Email?: string; Name?: string };
  From?: string;
  ToFull?: Array<{ Email?: string }>;
  To?: string;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
}

export function parsePostmarkInbound(payload: unknown): InboundEmail {
  const data = payload as PostmarkInboundPayload;
  const fromEmail = data.FromFull?.Email ?? data.From ?? "";
  const toEmail = data.ToFull?.[0]?.Email ?? data.To ?? "";

  return {
    from: fromEmail,
    fromName: data.FromFull?.Name,
    to: toEmail,
    subject: data.Subject ?? "(no subject)",
    textBody: data.TextBody ?? stripHtml(data.HtmlBody ?? ""),
    htmlBody: data.HtmlBody,
    messageId: data.MessageID,
  };
}

export const postmarkParser: InboundEmailParser = {
  parse: parsePostmarkInbound,
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
