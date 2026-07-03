import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Honor the `_`-prefix convention for deliberately-unused bindings (e.g. a
  // future-seam param like `_ownerId`, or a key dropped via object rest), and
  // ignore rest-sibling omits. Genuine dead code is still flagged.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees live under .claude/worktrees/ and hold full repo copies.
    // Without this, `npm run lint` (bare `eslint .`) descends into every active
    // worktree and lints its scripts/ copies too, so a release's lint gate fails
    // on files that aren't even in this tree. Each worktree still lints its own
    // code when eslint runs from inside it (paths are relative). Ignore the whole
    // .claude/ dir — nothing there is project source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
