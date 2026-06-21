import { absolutePublicAssetPath } from "@/lib/email/site-origin";
import { emailColors, emailFonts } from "@/lib/email/templates/colors";
import { escapeHtml } from "@/lib/email/templates/escape-html";

export const EMAIL_HEADER_IMAGE_PATH = "/generic_email_header.svg";

export type MagicLinkEmailButtonImage = {
  path: string;
  alt?: string;
  width?: number;
};

export const CANOE_SIGNIN_BUTTON_IMAGE: MagicLinkEmailButtonImage = {
  path: "/canoe_signin_button.svg",
  alt: "Communication Canoe",
  width: 80,
};

export type MagicLinkEmailLayoutContent = {
  title: string;
  headline: string;
  bodyParagraphs: string[];
  noticeParagraphs: string[];
  buttonLabel: string;
  buttonImageLeft?: MagicLinkEmailButtonImage;
  url: string;
  email: string;
};

function renderButtonRow(content: MagicLinkEmailLayoutContent, href: string): string {
  const buttonHtml = `<a ses:no-track href="${href}" style="display: inline-block; min-height: 44px; min-width: 240px; padding: 14px 64px; background-color: ${emailColors.accent}; color: ${emailColors.paperOnAccent}; text-decoration: none; border-radius: 9999px; font-size: 16px; font-weight: 600; line-height: 1.2; text-align: center; box-sizing: border-box;">${escapeHtml(content.buttonLabel)}</a>`;

  if (!content.buttonImageLeft) {
    return buttonHtml;
  }

  const image = content.buttonImageLeft;
  const imageSrc = absolutePublicAssetPath(image.path);
  const imageWidth = image.width ?? 80;
  const imageAlt = image.alt ?? "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 0 auto;">
    <tr>
      <td style="vertical-align: middle; padding-right: 16px;">
        <img src="${imageSrc}" alt="${escapeHtml(imageAlt)}" width="${imageWidth}" style="display: block; width: ${imageWidth}px; max-width: ${imageWidth}px; height: auto; border: 0;">
      </td>
      <td style="vertical-align: middle;">
        ${buttonHtml}
      </td>
    </tr>
  </table>`;
}

function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : url.replace(/"/g, "%22");
}

export function renderMagicLinkEmailHtml(
  content: MagicLinkEmailLayoutContent,
): string {
  const headerSrc = absolutePublicAssetPath(EMAIL_HEADER_IMAGE_PATH);
  const href = safeHref(content.url);
  const bodyHtml = content.bodyParagraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${emailColors.ink2};">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  const buttonRowHtml = renderButtonRow(content, href);
  const noticeHtml = content.noticeParagraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 12px; font-size: 14px; line-height: 1.5; color: ${emailColors.ink3};">${escapeHtml(paragraph)}</p>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(content.title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${emailColors.paper2}; font-family: ${emailFonts.sans}; color: ${emailColors.ink};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${emailColors.paper2};">
      <tr>
        <td align="center" style="padding: 24px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; background-color: ${emailColors.paper}; border: 1px solid ${emailColors.line}; border-radius: 14px; overflow: hidden;">
            <tr>
              <td align="center" style="padding: 0; background-color: ${emailColors.paper};">
                <img src="${headerSrc}" alt="Communication Canoe" width="600" style="display: block; width: 100%; max-width: 600px; height: auto; border: 0;">
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 32px 32px 8px;">
                <h1 style="margin: 0; font-family: ${emailFonts.serif}; font-size: 28px; font-weight: 400; line-height: 1.25; color: ${emailColors.ink};">${escapeHtml(content.headline)}</h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 8px 32px 24px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 0 32px 24px; border-top: 1px solid ${emailColors.line};">
                <div style="padding-top: 24px;">
                  ${noticeHtml}
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 0 32px 32px;">
                ${buttonRowHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 0 32px 32px;">
                <p style="margin: 0 0 8px; font-size: 13px; line-height: 1.5; color: ${emailColors.ink3};">Or copy and paste this link into your browser:</p>
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: ${emailColors.ink3}; word-break: break-all;">${escapeHtml(content.url)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding: 20px 32px 28px; background-color: ${emailColors.paper2}; border-top: 1px solid ${emailColors.line};">
                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: ${emailColors.ink3};">This email was sent to ${escapeHtml(content.email)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderMagicLinkEmailText(
  content: MagicLinkEmailLayoutContent,
): string {
  const sections = [
    "Communication Canoe",
    "",
    content.headline,
    "",
    ...content.bodyParagraphs,
    "",
    ...content.noticeParagraphs,
    "",
    `${content.buttonLabel}: ${content.url}`,
    "",
    `This email was sent to ${content.email}`,
  ];
  return sections.join("\n").trim();
}
