import { afterEach, describe, expect, it } from "vitest";
import { createDomainService } from "./index";
import { createAdminService } from "./admin";

const REALTIME_KEYS = [
  "INTERNAL_API_SECRET",
  "REALTIME_BRIDGE_URL",
  "VOICE_BRIDGE_URL",
] as const;

const saved = new Map<string, string | undefined>();

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("service construction without realtime credentials", () => {
  /**
   * A service is constructed per worker tick - five workers in the bridge,
   * every few seconds - so anything the constructor demands is demanded
   * thousands of times a day on services that may not have it. This used to
   * fail with "Missing SUPABASE_URL", because the constructor eagerly built a
   * Supabase client for a Realtime broadcast almost no tick ever sent.
   *
   * The Supabase client is gone, but the shape of that bug is not: the
   * dashboard fan-out it was replaced with also needs credentials, and they
   * belong at the call that broadcasts, not at construction. Only the two
   * lines below prove it stayed that way.
   *
   * Construction only: no database is touched, so this fails for the right
   * reason rather than needing a live connection.
   */
  it("does not require broadcast credentials just to construct a service", () => {
    for (const key of REALTIME_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }

    expect(() => createDomainService()).not.toThrow();
    expect(() => createAdminService()).not.toThrow();
  });
});
