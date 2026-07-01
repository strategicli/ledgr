-- The `memory` type (AI Memory subsystem, ADR-137): the durable, linkable store
-- an AI assistant reads over MCP. A bespoke, user-controllable type
-- (is_system=false) on the default markdown canvas — the Related panel is the
-- serendipity graph (a memory is *about* people/projects/notes via universal
-- relations, not a typed field), and the three built-in properties drive the
-- always-on "stump" index:
--   kind    — user | feedback | project | reference (mirrors the memory frontmatter)
--   horizon — evergreen | seasonal | episodic (how long the fact stays true;
--             the stump generator keeps evergreen always-on and ages the rest out)
--   pinned  — force a stump into the always-on index regardless of horizon/age
-- hidden=true keeps it out of every Work surface, the destination picker, and the
-- generic MCP list_types (it is an AI/system concern, not "normal work", like the
-- `unmarked` type) while getType still renders /list/memory and the Build → AI
-- Memory page. The user can still add their own properties on top via
-- Build → Types (which lists includeHidden). No status affordance (status_mode
-- left NULL → resolves to 'none'). Additive + idempotent. Mirrors the seed.mjs entry.
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden, property_schema)
VALUES (
  'memory', 'Memory', 'sparkles', false, false, true,
  '[{"key":"kind","label":"Kind","kind":"select","options":["user","feedback","project","reference"]},{"key":"horizon","label":"Horizon","kind":"select","options":["evergreen","seasonal","episodic"]},{"key":"pinned","label":"Pinned","kind":"checkbox"}]'::jsonb
)
ON CONFLICT (key) DO NOTHING;
