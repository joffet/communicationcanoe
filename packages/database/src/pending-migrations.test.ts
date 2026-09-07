import { describe, expect, it } from "vitest";

// @ts-expect-error - plain .mjs beside the script that uses it, no types.
import { pendingAgainst } from "../scripts/pending-migrations.mjs";

type Entry = { tag: string; when: number };

const entry = (tag: string, when: number): Entry => ({ tag, when });

describe("pendingAgainst", () => {
  it("reports nothing when the watermark is at or past the last migration", () => {
    const entries = [entry("0000_a", 100), entry("0001_b", 200)];
    expect(pendingAgainst(entries, 200)).toEqual([]);
  });

  it("reports every migration when the ledger is empty", () => {
    const entries = [entry("0000_a", 100), entry("0001_b", 200)];
    expect(pendingAgainst(entries, null).map((e: Entry) => e.tag)).toEqual([
      "0000_a",
      "0001_b",
    ]);
  });

  it("reports only what sits above the watermark", () => {
    const entries = [entry("0000_a", 100), entry("0001_b", 200), entry("0002_c", 300)];
    expect(pendingAgainst(entries, 100).map((e: Entry) => e.tag)).toEqual([
      "0001_b",
      "0002_c",
    ]);
  });

  it("treats a migration exactly at the watermark as applied", () => {
    // Strictly greater, matching the migrator's `created_at < folderMillis`.
    // Off-by-one the other way would re-run the migration the watermark names.
    expect(pendingAgainst([entry("0000_a", 100)], 100)).toEqual([]);
  });

  // The bug this replaced. On 2026-09-07 the production ledger held 8 rows
  // against a 7-entry journal - one row matching no file in the repo, from a
  // locally generated migration that was applied and then discarded - so
  // `applied < expected` read 8 < 7 and passed. Adding one migration would
  // have made it 8 < 8: still passing, with that migration unapplied.
  it("catches an unapplied migration that a row count would wave through", () => {
    const entries = [
      entry("0000_a", 100),
      entry("0001_b", 200),
      entry("0002_c", 300), // never applied
    ];
    const ledgerRows = 3; // two of ours, plus one orphan from a discarded file
    expect(ledgerRows < entries.length).toBe(false); // the old check: passes
    expect(pendingAgainst(entries, 200).map((e: Entry) => e.tag)).toEqual(["0002_c"]);
  });

  // A migration renumbered AFTER it was applied gets a `when` above the
  // watermark, so the migrator re-runs it and it fails on the objects it
  // already created, blocking every migration behind it for every session.
  // Reporting it as pending is the honest answer; a count cannot see it.
  it("reports a migration renumbered after it was applied", () => {
    const renumbered = [entry("0000_a", 100), entry("0001_b", 999)];
    expect(pendingAgainst(renumbered, 500).map((e: Entry) => e.tag)).toEqual(["0001_b"]);
  });
});
