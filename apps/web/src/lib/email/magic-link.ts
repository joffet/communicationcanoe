import { sendSesEmail } from "./ses";

export async function sendMagicLinkEmail(options: {
  to: string;
  url: string;
}): Promise<void> {
  const { to, url } = options;

  await sendSesEmail({
    to,
    subject: "Sign in to Contact",
    html: `
      <p>Click the link below to sign in. This link expires in 5 minutes.</p>
      <p><a href="${url}">Sign in to Contact</a></p>
      <p>If you did not request this email, you can ignore it.</p>
    `,
    text: `Sign in to Contact: ${url}\n\nThis link expires in 5 minutes. If you did not request this email, you can ignore it.`,
  });
}
