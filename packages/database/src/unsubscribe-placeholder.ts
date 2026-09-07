import { RESIDE_UNSUBSCRIBE_PLACEHOLDER } from "@communication-canoe/shared/schemas";

/**
 * Puts one recipient's own unsubscribe link into a bulk body.
 *
 * A recipient with no link gets the placeholder removed rather than left in
 * place - a literal `{{reside_unsubscribe_url}}` in a sent email is the kind
 * of thing only a resident ever notices, and by then it has gone to everyone.
 *
 * Removing it can leave `href=""`, which in a mail client is a live link back
 * to the message, so the surrounding anchor goes too when there is nothing to
 * point it at.
 */
const ANCHOR_AROUND_PLACEHOLDER = new RegExp(
  `<a\\b[^>]*href="${RESIDE_UNSUBSCRIBE_PLACEHOLDER.replace(/[{}]/g, "\\$&")}"[^>]*>.*?</a>`,
  "gis",
);

export function applyUnsubscribePlaceholder(body: string, unsubscribeUrl?: string | null): string {
  if (!body.includes(RESIDE_UNSUBSCRIBE_PLACEHOLDER)) return body;
  if (!unsubscribeUrl) return body.replace(ANCHOR_AROUND_PLACEHOLDER, "").split(RESIDE_UNSUBSCRIBE_PLACEHOLDER).join("");
  // split/join, not replace: a URL can contain `$&`, and String.replace would
  // read that as a backreference and paste the match back in.
  return body.split(RESIDE_UNSUBSCRIBE_PLACEHOLDER).join(unsubscribeUrl);
}
