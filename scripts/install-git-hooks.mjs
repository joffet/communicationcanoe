#!/usr/bin/env node
/**
 * Points git at the committed `.githooks/` directory.
 *
 * `.git/hooks` is not version controlled, so a hook that lives there is
 * invisible to everyone else and vanishes on a fresh clone - which is how
 * this repo had no hooks at all while four broken builds went out.
 * `core.hooksPath` lives in `.git/config`, so setting it once covers the
 * checkout and any worktree of it.
 *
 * The path is set **relative**, deliberately: git resolves a relative
 * hooksPath against the root of whichever worktree the hook runs in, so each
 * one checks its own tree with its own install. An absolute path would point
 * every worktree at a single tree's copy.
 *
 * Run from `prepare`, so `pnpm install` wires it up. Safe to run by hand:
 *   node scripts/install-git-hooks.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const HOOKS_PATH = ".githooks";

// A CI runner also fires prepare. There is no developer there to protect and
// no push to gate, and writing git config on a throwaway checkout is noise.
if (process.env.CI) {
  process.exit(0);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

try {
  git("rev-parse", "--git-dir");
} catch {
  // Not a git checkout - an install from a tarball, say. Nothing to do.
  process.exit(0);
}

if (!existsSync(HOOKS_PATH)) {
  console.warn(`install-git-hooks: ${HOOKS_PATH}/ not found, leaving core.hooksPath alone`);
  process.exit(0);
}

let current = "";
try {
  current = git("config", "--local", "--get", "core.hooksPath");
} catch {
  // Unset: `git config --get` exits 1 when the key is missing.
}

if (current === HOOKS_PATH) {
  process.exit(0);
}

// Someone pointed this somewhere else on purpose (husky, a personal hooks
// dir). Say so and leave it: silently retargeting another tool's hooks is a
// worse outcome than this check not running.
if (current) {
  console.warn(
    `install-git-hooks: core.hooksPath is already "${current}", not changing it. ` +
      `Run \`git config --local core.hooksPath ${HOOKS_PATH}\` to use the repo's hooks.`
  );
  process.exit(0);
}

git("config", "--local", "core.hooksPath", HOOKS_PATH);
console.log(`install-git-hooks: core.hooksPath -> ${HOOKS_PATH}`);
