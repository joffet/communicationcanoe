import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { requireSession } from "@/lib/auth/session";

export default async function LoginPage() {
  const session = await requireSession();
  if (session) redirect("/inbox");

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-zinc-500">We&apos;ll email you a magic link</p>
        </div>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
          <LoginForm />
        </Suspense>
        <p className="text-center text-xs text-zinc-400">
          New here? Enter your email — we&apos;ll create your account when you use the link.
          Ask a tenant admin to grant inbox access.
        </p>
      </div>
    </main>
  );
}
