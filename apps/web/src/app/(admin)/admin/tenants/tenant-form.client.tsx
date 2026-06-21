"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Tenant } from "@communication-canoe/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTenantAction, updateTenantAction } from "./actions";

type TenantFormProps = {
  tenant?: Tenant | null;
};

export function TenantForm({ tenant }: TenantFormProps) {
  const router = useRouter();
  const isEdit = Boolean(tenant?.id);
  const [name, setName] = useState(tenant?.name ?? "");
  const [twilioNumber, setTwilioNumber] = useState(tenant?.twilio_number ?? "");
  const [inboundEmail, setInboundEmail] = useState(
    tenant?.inbound_email_address ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      name,
      twilio_number: twilioNumber,
      inbound_email_address: inboundEmail,
    };

    if (isEdit && tenant) {
      const result = await updateTenantAction(tenant.id, payload);
      setBusy(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
      return;
    }

    const result = await createTenantAction(payload);
    setBusy(false);
    if (result && "message" in result && !result.ok) {
      setError(result.message);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="max-w-lg space-y-5">
      <div className="space-y-2">
        <Label htmlFor="tenant-name">Name</Label>
        <Input
          id="tenant-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={busy}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tenant-twilio">Twilio number</Label>
        <Input
          id="tenant-twilio"
          value={twilioNumber}
          onChange={(e) => setTwilioNumber(e.target.value)}
          required
          disabled={busy}
          placeholder="+15551234567"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="tenant-email">Inbound email address</Label>
        <Input
          id="tenant-email"
          type="email"
          value={inboundEmail}
          onChange={(e) => setInboundEmail(e.target.value)}
          required
          disabled={busy}
          placeholder="support@example.com"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create tenant"}
        </Button>
        <Button type="button" variant="outline" disabled={busy}>
          <Link href="/admin/tenants">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
