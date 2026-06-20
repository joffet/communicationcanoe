import { redirect } from "next/navigation";

export default async function ConversationRedirectPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  redirect(`/inbox?c=${conversationId}`);
}
