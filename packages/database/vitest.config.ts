import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Each test file starts its own pglite - a whole Postgres in WASM - and
    // seven of them racing turned a 10-second suite into a 67-second one, with
    // files timing out at 60s and reporting as failures rather than as
    // contention. Running files one at a time is faster here and, more
    // importantly, deterministic: a timeout that depends on how many cores are
    // free is a flake nobody can reproduce.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
