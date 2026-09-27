import type { InboundEmail, InboundEmailParser } from "./index";

interface PostmarkInboundPayload {
  FromFull?: { Email?: string; Name?: string };
  From?: string;
  ToFull?: Array<{ Email?: string }>;
  To?: string;
  CcFull?: Array<{ Email?: string }>;
  BccFull?: Array<{ Email?: string }>;
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
}

export function parsePostmarkInbound(payload: unknown): InboundEmail {
  const data = payload as PostmarkInboundPayload;
  const fromEmail = data.FromFull?.Email ?? data.From ?? "";
  const toEmail = data.ToFull?.[0]?.Email ?? data.To ?? "";
  // A forwarded message (e.g. info@building -> forwardemail.net -> Postmark)
  // keeps its original headers, so these are the addresses the resident
  // wrote, not Postmark's inbound hash address.
  const recipients = [...(data.ToFull ?? []), ...(data.CcFull ?? []), ...(data.BccFull ?? [])]
    .map((r) => r.Email?.trim())
    .filter((e): e is string => Boolean(e));

  return {
    from: fromEmail,
    fromName: data.FromFull?.Name,
    to: toEmail,
    recipients: recipients.length > 0 ? recipients : toEmail ? [toEmail] : [],
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
