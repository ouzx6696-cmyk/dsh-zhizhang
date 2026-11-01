import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "bundle/**",
      "dist-pack/**",
      "apps/desktop/out/**",
      "apps/desktop/out-test/**",
      "apps/desktop/release/**",
      "test-results/**",
      "playwright-report/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.node, ...globals.browser, NodeJS: "readonly" },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      "no-empty": "error",
      "no-constant-condition": "error",
      "no-fallthrough": "error",
    },
  },
];
