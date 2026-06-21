const pendingInviteEmails = new Set<string>();

export function markPendingInviteEmail(email: string): void {
  pendingInviteEmails.add(email.trim().toLowerCase());
}

export function consumeInviteEmailVariant(email: string): "login" | "invite" {
  const key = email.trim().toLowerCase();
  if (pendingInviteEmails.has(key)) {
    pendingInviteEmails.delete(key);
    return "invite";
  }
  return "login";
}
