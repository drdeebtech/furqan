import { defineConfig, globalIgnores } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // fixupConfigRules patches eslint-plugin-react (bundled in eslint-config-next)
  // to work with ESLint 10, which removed context.getFilename() in favour of
  // context.filename / context.getPhysicalFilename().
  ...fixupConfigRules(nextVitals),
  ...fixupConfigRules(nextTs),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // App Router server components run once per request, not per render.
    // Date.now() and similar are intentionally request-scoped here, so
    // the React 19 purity rule produces false positives. Client components
    // use "use client" and remain subject to the rule via the global config.
    files: ["src/app/**/page.tsx", "src/app/**/layout.tsx"],
    rules: {
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tooling + load-test scripts run under non-Next runtimes (Node CommonJS
    // hooks, the k6 VM) where `require()` is correct — they are not app source
    // and must not be linted by the Next.js TS config (issue #325).
    ".claude/**",
    "k6/**",
    // External tooling directory (claude-flow / ECC scaffolding) — CJS scripts,
    // not app source.
    "ECC/**",
  ]),
]);

export default eslintConfig;
