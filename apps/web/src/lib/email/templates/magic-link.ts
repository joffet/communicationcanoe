import {
  CANOE_SIGNIN_BUTTON_IMAGE,
  renderMagicLinkEmailHtml,
  renderMagicLinkEmailText,
  type MagicLinkEmailLayoutContent,
} from "@/lib/email/templates/layout";

export type MagicLinkEmailVariant = "login" | "invite";

const SUBJECTS: Record<MagicLinkEmailVariant, string> = {
  login: "Sign in to Communication Canoe",
  invite: "You've been invited to Communication Canoe",
};

function buildContent(
  variant: MagicLinkEmailVariant,
  input: { url: string; email: string },
): MagicLinkEmailLayoutContent {
  if (variant === "invite") {
    return {
      title: SUBJECTS.invite,
      headline: "Welcome to Communication Canoe",
      bodyParagraphs: [
        "An administrator created a Communication Canoe account for you.",
        "Use the button below to sign in and get started.",
      ],
      noticeParagraphs: [
        "This link expires in 5 minutes.",
        "If you were not expecting this invitation, you can safely ignore this email.",
      ],
      buttonLabel: "Accept invitation",
      buttonImageLeft: CANOE_SIGNIN_BUTTON_IMAGE,
      url: input.url,
      email: input.email,
    };
  }

  return {
    title: SUBJECTS.login,
    headline: "Sign in to Communication Canoe",
    bodyParagraphs: [
      "You requested a sign-in link for your Communication Canoe account.",
    ],
    noticeParagraphs: [
      "This link expires in 5 minutes.",
      "If you did not request this email, you can safely ignore it.",
    ],
    buttonLabel: "Sign in",
    buttonImageLeft: CANOE_SIGNIN_BUTTON_IMAGE,
    url: input.url,
    email: input.email,
  };
}

export function renderCanoeMagicLinkHtml(input: {
  url: string;
  email: string;
  variant?: MagicLinkEmailVariant;
}): string {
  const variant = input.variant ?? "login";
  return renderMagicLinkEmailHtml(buildContent(variant, input));
}

export function renderCanoeMagicLinkText(input: {
  url: string;
  email: string;
  variant?: MagicLinkEmailVariant;
}): string {
  const variant = input.variant ?? "login";
  return renderMagicLinkEmailText(buildContent(variant, input));
}

export function magicLinkSubject(variant: MagicLinkEmailVariant = "login"): string {
  return SUBJECTS[variant];
}
