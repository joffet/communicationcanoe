import { describe, expect, it } from "vitest";
import { parsePostmarkInbound } from "./postmark";

describe("parsePostmarkInbound recipients", () => {
  it("lists To, then Cc, then Bcc addresses", () => {
    const email = parsePostmarkInbound({
      From: "resident@example.com",
      ToFull: [{ Email: "someone@example.com" }, { Email: "info@building.example" }],
      CcFull: [{ Email: "cc@example.com" }],
      BccFull: [{ Email: "bcc@example.com" }],
      OriginalRecipient: "hash@inbound.postmarkapp.com",
    });
    expect(email.to).toBe("someone@example.com");
    expect(email.recipients).toEqual([
      "someone@example.com",
      "info@building.example",
      "cc@example.com",
      "bcc@example.com",
    ]);
  });

  it("falls back to the plain To header when ToFull is absent", () => {
    const email = parsePostmarkInbound({ From: "a@example.com", To: "info@building.example" });
    expect(email.recipients).toEqual(["info@building.example"]);
  });

  it("is empty, not [''], when there is no recipient at all", () => {
    expect(parsePostmarkInbound({ From: "a@example.com" }).recipients).toEqual([]);
  });
});
