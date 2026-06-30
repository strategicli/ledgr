-- Milestone type (Project Type, ADR-111/PJ5). A bespoke polymorphic collection
-- item attachable to any record via a home edge (PRD §6). The defining semantic:
-- a milestone ARRIVES whether you act or not — no done-state. Its date is
-- items.due_date; upcoming/passed is DERIVED from the date vs the clock, never a
-- checkbox. status_mode='none' so its canvas shows no status affordance. Hidden
-- + not in quick capture: it's collection content, not a top-level nav type.
INSERT INTO types (key, label, icon, is_system, show_in_quick_capture, hidden, status_mode, property_schema)
VALUES ('milestone', 'Milestone', 'flag', true, false, true, 'none', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;
