/**
 * Flat config. ESLint 9 is required by Next 16, and `next lint` was removed in
 * the same release, so the lint script calls eslint directly.
 *
 * eslint-config-next@16 already ships flat config, so it is spread in as-is —
 * no FlatCompat layer, which chokes on it.
 */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  {
    ignores: [
      ".next/**",
      ".next-e2e/**",
      ".next-verify/**",
      ".open-next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@next/next/no-html-link-for-pages": "off",

      // Arrived with the Next 16 upgrade and fires on twelve pre-existing
      // call sites, none of them a regression. Every one is a real cascading
      // render worth removing, but rewriting effect bodies changes behaviour,
      // and doing it in the same change as a framework upgrade would make any
      // resulting bug impossible to attribute. Kept visible as a warning until
      // it can be fixed on its own.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];
