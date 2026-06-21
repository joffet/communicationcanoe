"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const redirect = searchParams.get("redirect") ?? "/inbox";
    const { error: signInError } = await authClient.signIn.magicLink({
      email,
      callbackURL: redirect,
    });

    if (signInError) {
      setError(signInError.message ?? "Could not send sign-in link");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Check your email for a sign-in link sent to <strong>{email}</strong>.
        </p>
        <p className="text-xs text-zinc-500">The link expires in 5 minutes.</p>
        <Button type="button" variant="outline" onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={loading}>
        {loading ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
