import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses";
import nodemailer from "nodemailer";
import { resolveMailFrom, type TenantMailFrom } from "./from";
import type { FetchedEmailAttachment } from "./attachments";

const region =
  process.env.AMAZON_SES_REGION ?? process.env.AWS_REGION ?? "ca-central-1";

let client: SESClient | null = null;

function getSesClient(): SESClient {
  if (!client) {
    client = new SESClient({
      region,
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }
  return client;
}

export async function sendSesEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tenant?: TenantMailFrom | null;
  configurationSetName?: string;
  /** MIME-attached via SendRawEmailCommand when present - see
   * sendRawSesEmail below. SendEmailCommand (the plain path) cannot carry
   * attachments at all, so this branches the transport rather than always
   * paying the raw-MIME cost. */
  attachments?: FetchedEmailAttachment[];
}): Promise<{ messageId?: string }> {
  const from = options.from ?? resolveMailFrom(options.tenant);
  const text = options.text ?? stripHtml(options.html);

  if (options.attachments && options.attachments.length > 0) {
    return sendRawSesEmail({ ...options, from, text, attachments: options.attachments });
  }

  const result = await getSesClient().send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [options.to] },
      ...(options.replyTo ? { ReplyToAddresses: [options.replyTo] } : {}),
      Message: {
        Subject: { Data: options.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: options.html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
      ConfigurationSetName: options.configurationSetName,
    }),
  );

  return { messageId: result.MessageId };
}

/**
 * Same delivery as sendSesEmail's plain path (SES, same Source/Destination/
 * Subject/Body/ConfigurationSetName), but composed as a raw RFC 5322 message
 * and sent via SendRawEmailCommand - the only SES API that can carry a MIME
 * attachment. SendEmailCommand has no attachment parameter at all.
 *
 * The message is assembled by nodemailer's streamTransport with `buffer:
 * true`, which builds the exact bytes a real SMTP send would produce but
 * never opens a connection or delivers anything - `info.message` is the
 * built buffer, handed to SES as-is. No MIME builder was already a
 * dependency here; nodemailer (added for this) can build one without ever
 * sending through it.
 */
async function sendRawSesEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from: string;
  replyTo?: string;
  configurationSetName?: string;
  attachments: FetchedEmailAttachment[];
}): Promise<{ messageId?: string }> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const built = await transport.sendMail({
    from: options.from,
    to: options.to,
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  });

  const raw = built.message;
  if (!Buffer.isBuffer(raw)) {
    throw new Error("nodemailer streamTransport did not return a buffered message");
  }

  const result = await getSesClient().send(
    new SendRawEmailCommand({
      Source: options.from,
      Destinations: [options.to],
      RawMessage: { Data: raw },
      ConfigurationSetName: options.configurationSetName,
    }),
  );

  return { messageId: result.MessageId };
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
