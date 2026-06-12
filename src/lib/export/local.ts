// Local-filesystem export target: verification scripts point the engine at
// a temp directory, and a Phase 4 local build points it at a real folder.
// Imports node:fs, so only scripts and local builds may import this module
// (the Vercel routes use the OneDrive target).
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExportTarget } from "./target";

export class LocalExportTarget implements ExportTarget {
  constructor(private rootDir: string) {}

  private resolve(path: string): string {
    const full = join(this.rootDir, ...path.split("/"));
    if (!full.startsWith(this.rootDir)) {
      throw new Error(`export path escapes the root: ${path}`);
    }
    return full;
  }

  async putFile(path: string, content: Uint8Array | string): Promise<void> {
    const full = this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }

  async deleteFile(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true });
  }
}
