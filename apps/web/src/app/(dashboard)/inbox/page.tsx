import { redirect } from "next/navigation";
import { InboxShell } from "@/components/inbox/inbox-shell";
import { getActiveTenantId } from "@/lib/tenant";
import { createDomainService } from "@contact/database";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const tenantId = await getActiveTenantId();
  if (!tenantId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        No tenant membership found. Ask an admin to add you to a tenant.
      </div>
    );
  }

  const params = await searchParams;
  const domain = createDomainService();
  const conversations = await domain.getConversationsForTenant(tenantId);

  const selectedId = params.c ?? conversations[0]?.id ?? null;
  let thread = null;
  if (selectedId) {
    thread = await domain.getConversationThread(selectedId);
    if (thread && thread.tenant_id !== tenantId) {
      redirect("/inbox");
    }
  }

  return (
    <InboxShell
      tenantId={tenantId}
      conversations={conversations}
      selectedId={selectedId}
      thread={thread}
    />
  );
}
