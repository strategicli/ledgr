# Exploration: rich export formatting, icons, export templates, and CSS theming

**Status:** parked (Brandon, 2026-06-14). Not intent, not a decision. Several related ideas grouped here.

## 1. Polished Word/PDF export

Today, the print view and OneDrive export render the markdown body faithfully but without visual polish — no cover image, no icon, no header/footer chrome, plain typography.

Brandon wants exports to look good: think Notion's "header image + emoji icon + title" layout, or a document with the church letterhead and logo. The output should feel like something you'd hand to someone, not just a raw markdown dump.

**Approaches:**
- **Enhanced print CSS.** The existing `@media print` path in `/items/[id]/print` could be enriched — a configurable header zone (item icon + cover image), a footer with page numbers and a logo, better typography. No new tooling, just CSS and a header component in the print render.
- **Pandoc for `.docx`/PDF.** The CLAUDE.md stack note mentions pandoc as the path to `.docx` (especially for Tyler's Papers module). A Pandoc template (`.docx` reference document or a LaTeX `.tex` template) could define the branded layout, then `markdownToHtml` → pandoc pipes through it. The `ExporterDef` slot in the module registry is the right hook.
- **React-pdf / docx-js.** A JS-native renderer (no pandoc dependency). More work to maintain, but no server-side pandoc binary needed on Vercel. Worth evaluating against pandoc.

## 2. Icons for items and types

Brandon wants icons on items — either **manually chosen per item** (like Notion's emoji picker on a page) or **standardized per type** (a default icon for every note, every meeting, etc.).

**Per-type default icons:**
- Already partially in place: the type builder (slice 33 / ADR-044) stores an `icon` field on a type. The canvas and list views don't yet render it prominently. Surfacing `type.icon` in the canvas header and list rows is a small UI change.

**Per-item icon override:**
- An emoji/icon picker on the canvas title area (like Notion). Stores the chosen emoji or icon id in `properties.icon` (no schema change). The canvas header renders it if present, falls back to the type icon.
- Could combine with a **cover image** (a banner at the top of the canvas, stored as an R2 attachment reference in `properties.coverImage`).

**Constraint:** rule 5 (few dependencies) — use a simple emoji picker from an existing `@tiptap/*` package or a tiny standalone component rather than a heavyweight icon library.

## 3. Export templates for common formats

Brandon wants reusable document templates for outputs like church letterhead, sermon notes, weekly agenda, and meeting minutes — formats that combine a layout (header, footer, typography) with placeholder sections.

This is distinct from item templates (slice 34 / ADR-045), which pre-fill property defaults and a starter body. An **export template** controls the output format and wrapping chrome when the item is rendered to Word/PDF, not the content itself.

**Approaches:**
- **A named export layout per type (or per item).** The `ExporterDef` in the module registry takes a `render` function; an export template is a named variant of that function (`"letterhead"`, `"sermon-notes"`, `"agenda"`). The user picks from a dropdown before exporting.
- **Pandoc reference `.docx` files.** Pandoc supports a `--reference-doc` flag; different reference files give different looks. Store reference files in R2 or as static assets; the export API picks one based on the selected template.
- **CSS print templates.** For the print/PDF path, a per-template stylesheet (or a theme class on the print body) controls the visual output. Simpler, no pandoc required.

## 3b. A Markdown → styled-HTML re-render engine + a Presentations type (6.14 meeting)

The 6.14 Brandon + Tyler meeting added a sharper framing of the same renders-from-Markdown idea: a per-purpose **"reading engine" / re-render engine** that takes the stored Markdown and re-renders styled HTML to whatever structure and CSS you specify for a given output. You tell the engine the HTML shape/CSS you want; it produces the presentation layer, the Markdown stays the single source.

The strongest concrete use raised was a **bespoke Presentations type**: Markdown source pushed to HTML/JS as the actual slides/presentation. This sits cleanly inside the existing model (a type declares its canvas; its exporter renders from Markdown — ADR-041/043) and is the natural home for the "engine" idea. Treat it as a candidate bespoke module, not core. Storage caveat noted in the meeting: presentation **images** (~2MB each) are the real storage cost; the Markdown itself is trivial.

## 4. CSS snippets (Obsidian-style)

Obsidian lets users paste custom CSS into a `custom.css` file that overrides how the app and its exports look. Brandon is interested in the same for Ledgr — either for the canvas display (how notes look while editing/reading) or for exports.

**For canvas display:**
- A per-owner `custom_css` text field (stored in `users` or a settings table) injected as a `<style>` tag in the app shell. Lets power users change fonts, colors, spacing, density.
- Risk: arbitrary CSS can break layout. Scoping it to a `.canvas-body` wrapper reduces blast radius. A "reset to defaults" button is mandatory.

**For exports:**
- A named CSS snippet associated with an export template (see §3 above) that's inlined into the print document's `<style>`. The `renderPrintDocument()` function in `print-html.ts` already has an `inline CSS` section; parameterizing it is a small change.

**Constraint (rule 5):** no CSS sandboxing library. Scope by class prefix and document clearly that snippets can break things.

## Relationship to other work

- **Item templates (ADR-045)** set starter content; these export templates set output presentation. Different concerns, but they pair well — a "Sermon Notes" item template + a "Sermon Notes" export template gives a complete per-use-case experience.
- **Per-type canvas seam (ADR-041) + module registry (ADR-043).** The `ExporterDef` slot is the correct registration point for export templates. A module declaring multiple named exporters is the clean path.
- **OneDrive export (ADR-017).** The nightly export writes raw markdown; a richer export template would apply to the on-demand print/share path, not the OneDrive sync (which is meant to stay as plain markdown).

## Open questions

- Which export format is the priority? Word (`.docx` for sharing/editing), PDF (for printing/archiving), or HTML (for sharing online)?
- Is per-item icon override worth the UX complexity, or is per-type default sufficient?
- How much CSS theming power does Brandon actually want? A handful of preset themes (Light, Warm, Serif) may be more practical than arbitrary snippets for a first pass.
- Should export templates live in the Build surface (type builder) or as a top-level setting?
