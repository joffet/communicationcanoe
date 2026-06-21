import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { resolveMailFrom, type TenantMailFrom } from "./from";

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
  tenant?: TenantMailFrom | null;
}): Promise<void> {
  const from = options.from ?? resolveMailFrom(options.tenant);
  const text = options.text ?? stripHtml(options.html);

  await getSesClient().send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [options.to] },
      Message: {
        Subject: { Data: options.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: options.html, Charset: "UTF-8" },
          Text: { Data: text, Charset: "UTF-8" },
        },
      },
    }),
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
