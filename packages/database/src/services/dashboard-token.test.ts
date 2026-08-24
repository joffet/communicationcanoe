import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardToken, verifyDashboardToken } from "./dashboard-token";
import { asTenantId } from "@communication-canoe/shared/brands";

const TENANT = asTenantId("11111111-1111-1111-1111-111111111111");
const payload = { userId: "user-1", name: "Ada", tenantId: TENANT };

let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.INTERNAL_API_SECRET;
  process.env.INTERNAL_API_SECRET = "test-secret";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.INTERNAL_API_SECRET;
  else process.env.INTERNAL_API_SECRET = previousSecret;
});

describe("dashboard tokens", () => {
  it("round-trips the identity the bridge scopes a socket by", () => {
    const verified = verifyDashboardToken(createDashboardToken(payload));
    expect(verified).toMatchObject(payload);
  });

  /**
   * The whole point of signing these. The tenant in the payload is the only
   * thing standing between an agent's socket and another tenant's
   * conversations, and it travels through the browser to get to the bridge.
   */
  it("rejects a token whose payload was edited in transit", () => {
    const [, signature] = createDashboardToken(payload).split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...payload,
        tenantId: "22222222-2222-2222-2222-222222222222",
        exp: Date.now() + 60_000,
      }),
    ).toString("base64url");

    expect(verifyDashboardToken(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = createDashboardToken(payload);
    process.env.INTERNAL_API_SECRET = "other-secret";
    expect(verifyDashboardToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    expect(verifyDashboardToken(createDashboardToken(payload, -1))).toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    expect(verifyDashboardToken("")).toBeNull();
    expect(verifyDashboardToken("not-a-token")).toBeNull();
    expect(verifyDashboardToken("a.b")).toBeNull();
  });

  /** The bridge and the web app share one secret; an unset one must fail
   * loudly at the mint rather than produce tokens signed with "undefined". */
  it("refuses to mint without a secret", () => {
    delete process.env.INTERNAL_API_SECRET;
    expect(() => createDashboardToken(payload)).toThrow(/INTERNAL_API_SECRET/);
  });
});
