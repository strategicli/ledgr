# Deploy workflow (proposal, for discussion)

> **Status: DRAFT. Not adopted yet.** This is a starting point for Brandon + Tyler to
> discuss and edit. Nothing here is in force until we both agree and flip the Vercel
> settings. Until then, the interim rule at the bottom applies.

## Why this exists

On 2026-07-01 we shipped the Project Type chunk to `main` and hit a real problem worth
fixing for good:

- We share one repo, and `main` is doing two jobs at once. It is the shared **integration
  line** (where both of us merge work) and it is also Brandon's **production deploy
  trigger** (his Vercel deploys from `main`).
- Because those are the same branch, "merge my work to `main`" also means "deploy
  Brandon's live site," whether or not that was the intent.
- There is no migrate-on-deploy. The build is a plain `next build`, and each instance runs
  `npm run db:migrate` by hand against its own database. So if new code deploys before the
  database is migrated, the app errors on the missing tables or columns (this release added
  `items.composition`, `relations.home`, and others that `getItem` selects unconditionally,
  so an un-migrated database breaks item reads across the whole site, not just the new
  pages).

The fix is to separate the two jobs `main` is doing, and to make "migrate before deploy"
automatic instead of a manual step we have to remember.

## Goals

1. Either of us can merge work to a shared line **without** touching the other's live site.
2. Each of us controls **when** our own production takes a change.
3. A database migration always runs **before** the code that needs it, with no human timing.
4. Keep the stack boring: no new services, reuse Vercel + Neon + GitHub Actions we already
   have.

## Proposed model: `main` is a staging line that deploys nobody

Each instance deploys from its **own** branch. `main` auto-deploys nothing.

| Branch | Role | Auto-deploys |
|---|---|---|
| `main` | Shared integration. Everyone merges here. | Nothing |
| `prod-brandon` | Brandon's production | Brandon's Vercel project |
| `prod-tyler` | Tyler's production (when Tyler stands one up) | Tyler's Vercel project |

### Everyday flow (both of us)

1. Work on a feature branch.
2. Open a PR into `main`. Merge it. This is always safe: it deploys nothing to production.
   (Vercel may still build a preview URL for review, which is a plus.)

### Release flow (each of us, on our own schedule)

1. Run `npm run db:migrate` against **our** production database (applies any new
   migrations).
2. Merge `main` into our own prod branch and push. Our Vercel project deploys.

Because the two prod branches are independent, Tyler can merge to `main` any time, and
Brandon takes it into `prod-brandon` only when he has migrated and is ready. The two release
cadences fully decouple.

## Making the ordering automatic (recommended, phase 2)

The thing that actually bit us is timing: code out before the database was ready. Kill it
permanently with a **release GitHub Action per instance**. We already use Actions for crons,
so this is familiar ground. On a push to a prod branch, the Action runs the migration first,
then deploys, so the order is impossible to get wrong.

Turn **off** Vercel's git auto-deploy for the prod branch so the Action owns the deploy
(otherwise the push triggers both the Action and Vercel at once, and the ordering is a race
again).

Sketch (each person fills in their own `DATABASE_URL` and Vercel token as repo/environment
secrets, scoped so we cannot deploy each other's instance):

```yaml
# .github/workflows/release-brandon.yml  (mirror for tyler)
name: Release (brandon)
on:
  push:
    branches: [prod-brandon]
jobs:
  migrate-then-deploy:
    runs-on: ubuntu-latest
    environment: prod-brandon      # holds the scoped secrets
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - name: Migrate database (must succeed before deploy)
        run: npm run db:migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}   # Brandon's prod pooler URL
      - name: Deploy to Vercel production
        run: npx vercel deploy --prod --yes --token=$VERCEL_TOKEN
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
```

If a migration fails, the deploy step never runs, so production stays on the working
version.

## Migration discipline: expand then contract

Even with the ordering automated, write migrations so a brief gap degrades gracefully
instead of erroring:

- **Expand first.** Add columns and tables as additive and nullable. Ship that migration and
  let it settle before code depends on it.
- **Then use.** In a later release, ship code that reads or writes the new shape.
- **Contract last.** Only drop or rename an old column after nothing reads it.

The rule of thumb: a single release should not add a column and, in the same release, have
core code hard-select that column. This release broke that rule (`getItem` selects the new
columns immediately), which is why an un-migrated database fails hard rather than softly.

## What each change requires

- **Git side (either of us can do):** create `prod-brandon` / `prod-tyler`, add the release
  Action, keep this doc current.
- **Vercel dashboard (each person, own project):**
  - Set **Production Branch** to your `prod-*` branch (Settings, Git).
  - Turn **off** "Automatically deploy" for pushes if the Action will deploy (phase 2), or
    leave it on for a simpler phase-1 that skips the Action and relies on the manual
    "migrate then merge to prod branch" order.
  - If you want safe PR previews, point the **Preview** environment's `DATABASE_URL` at a
    separate dev/preview Neon database, never prod.

## Open questions for us to decide

1. **Phase 1 only, or go straight to the Action?** Phase 1 (per-instance prod branches,
   manual "migrate then merge") solves the "don't nuke the other person" problem today with
   zero new automation. The Action (phase 2) additionally removes the manual migrate step.
2. **Does Brandon have a separate dev/preview Neon database,** or one database per instance?
   Preview deploys are only safe if Preview points at a non-prod database. If dev and prod
   share one Neon database, we skip PR previews (or add a preview branch database).
3. **Branch names.** `prod-brandon` / `prod-tyler`, or `brandon` / `tyler`, or something
   else. Cosmetic, but let us pick one.
4. **Who can deploy what.** Scope the Vercel tokens and `DATABASE_URL` secrets per instance
   (GitHub Environments) so neither of us can accidentally deploy the other's production.

## Interim rule (until we adopt the above)

`main` still deploys Brandon's production. So until we flip the branches:

- Do **not** merge a change to `main` that includes a new migration until the deploying
  party has run `npm run db:migrate` on their production database, or is standing by to.
- Coordinate in `COLLAB.md` + a quick ping before landing anything core on `main`.
- Rollback if a bad deploy lands: `git push origin <previous-main-sha>:main --force-with-lease`,
  then re-push once the database is migrated.
