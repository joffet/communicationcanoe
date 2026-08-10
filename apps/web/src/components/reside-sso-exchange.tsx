"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function ResideSsoExchange() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function exchange() {
      const res = await fetch("/api/auth/reside-sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (cancelled) return;

      if (!res.ok) {
        setError("Could not sign you in — the link may have expired");
        return;
      }

      const data = await res.json();
      router.replace(data.redirectTo ?? "/inbox");
    }

    void exchange();
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  if (!token || error) {
    return <p className="text-sm text-red-600">{error ?? "Missing token"}</p>;
  }

  return <p className="text-sm text-zinc-500">Signing you in…</p>;
}
