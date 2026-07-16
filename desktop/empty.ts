// Neutralizes `server-only` when @/lib runs in the Electron main process (a
// plain Node context, not a React Server Component). The main-process bundle
// aliases `server-only` → this file (see tsconfig paths + esbuild.mjs). ADR-139.
export {};
