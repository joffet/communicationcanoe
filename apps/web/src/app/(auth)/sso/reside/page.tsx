import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResideSsoExchange } from "@/components/reside-sso-exchange";
import { requireSession } from "@/lib/auth/session";

export default async function ResideSsoPage() {
  const session = await requireSession();
  if (session) redirect("/inbox");

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <Suspense fallback={<p className="text-sm text-zinc-500">Signing you in…</p>}>
          <ResideSsoExchange />
        </Suspense>
      </div>
    </main>
  );
}
