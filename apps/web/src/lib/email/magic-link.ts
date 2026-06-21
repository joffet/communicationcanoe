import { sendSesEmail } from "./ses";
import {
  magicLinkSubject,
  renderCanoeMagicLinkHtml,
  renderCanoeMagicLinkText,
  type MagicLinkEmailVariant,
} from "./templates/magic-link";

export async function sendMagicLinkEmail(options: {
  to: string;
  url: string;
  variant?: MagicLinkEmailVariant;
}): Promise<void> {
  const { to, url } = options;
  const variant = options.variant ?? "login";

  const html = renderCanoeMagicLinkHtml({ url, email: to, variant });
  const text = renderCanoeMagicLinkText({ url, email: to, variant });

  await sendSesEmail({
    to,
    subject: magicLinkSubject(variant),
    html,
    text,
  });
}
