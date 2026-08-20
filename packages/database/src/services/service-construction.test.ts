import { afterEach, describe, expect, it } from "vitest";
import { createDomainService } from "./index";
import { createAdminService } from "./admin";

const SUPABASE_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

afterEach(() => {
  for (const key of SUPABASE_KEYS) delete process.env[key];
});

describe("service construction without Supabase", () => {
  /**
   * The realtime-bridge carries a Postgres connection string and no Supabase
   * keys at all. It constructs a DomainService on every worker tick - five
   * workers, every few seconds - so building a Supabase client in the
   * constructor meant every tick threw "Missing SUPABASE_URL" before it
   * reached a query, on a service where nothing but the Realtime broadcast
   * uses Supabase any more.
   *
   * Construction only: no database is touched, so this fails for the right
   * reason rather than needing a live connection.
   */
  it("does not build a Supabase client just to construct the service", () => {
    for (const key of SUPABASE_KEYS) delete process.env[key];

    expect(() => createDomainService()).not.toThrow();
    expect(() => createAdminService()).not.toThrow();
  });
});
