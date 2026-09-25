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
  // The core fence (ADR-272, explorations/core-and-modules.md). Core is the
  // code every module may import from; core never imports a module. Files in
  // the core paths below may not import from `src/modules/**`. The rule passes
  // today because `src/modules/` is empty and starts failing as each module
  // moves there (plan step 4). `module-wiring.tsx`, `module-panels.tsx` and
  // `module-editor.tsx` are the deliberate exceptions: they are the impure half
  // of the registry that maps canvas ids, item-panel and shell-panel ids, and
  // the editor's module pieces to module components, so they are left out of
  // the fenced set.
  {
    files: [
      "src/db/**",
      "src/proxy.ts",
      "src/app/layout.tsx",
      "src/app/items/**",
      "src/components/nav/**",
      "src/components/markdown-editor/**",
      "src/components/canvas/ItemCanvas.tsx",
      "src/components/canvas/MarkdownCanvas.tsx",
      "src/components/canvas/LongformCanvas.tsx",
      "src/components/canvas/TaskCanvas.tsx",
      "src/components/canvas/EventCanvas.tsx",
      "src/components/canvas/WidgetCanvas.tsx",
      "src/lib/modules.ts",
      // The root layout's shell list: its components come from module-editor.tsx
      // (lazy), so a direct module import here would ship on every page.
      "src/lib/module-shells.tsx",
      "src/lib/items.ts",
      "src/lib/item-mutations.ts",
      "src/lib/relations*.ts",
      "src/lib/revisions*.ts",
      "src/lib/types.ts",
      "src/lib/views*.ts",
      "src/lib/dashboards*.ts",
      "src/lib/templates/**",
      "src/lib/body*.ts",
      "src/lib/markdown-render.ts",
      "src/lib/search*.ts",
      "src/lib/settings.ts",
      "src/lib/owner.ts",
      "src/lib/auth/**",
      "src/lib/build-nav.ts",
      "src/lib/storage/**",
      // The export engine is core (Save Offline, Principle 4); the OneDrive
      // target is a module and is handed in, never imported (ADR-272 step 4).
      "src/lib/export/**",
      "src/lib/sync/**",
      "src/lib/mcp/server.ts",
      "src/lib/mcp/protocol.ts",
      "src/lib/mcp/owner.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules", "@/modules/*", "@/modules/**", "**/src/modules/**"],
              message:
                "Core must not import a module. Modules register onto core through src/lib/modules.ts (ADR-272; explorations/core-and-modules.md).",
            },
          ],
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
