import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The database package's barrel reaches db.ts, which imports pg. A value
 * import from client code therefore pulls the Postgres driver into the browser
 * bundle, and the production build dies resolving dns/net/tls - something
 * neither typecheck nor the test suite catches. The brand helpers that client
 * code actually wants are re-exports, so import them from their own package
 * instead. Type-only imports are erased, and stay allowed.
 */
const noDatabaseInClientCode = {
  files: ["src/components/**/*.{ts,tsx}", "**/*.client.{ts,tsx}"],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@communication-canoe/database",
            message:
              "Client code cannot import this for values - its barrel pulls in pg and breaks the browser build. Use @communication-canoe/shared/brands for the brand helpers, or the global types in src/types/global.d.ts.",
            allowTypeImports: true,
          },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  noDatabaseInClientCode,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
