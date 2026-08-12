// The tags vocabulary, in one place (Tyler, 2026-08-12).
//
// Tagging is not its own mechanism: a tag is an ordinary item of the `tag` type,
// and tagging something is a `relations` edge pointing at it with role "tags"
// (ADR-094 E2, over ADR-067's typed relation kind). Both strings were previously
// literals living only in `drizzle/0028_tag_type_and_tags_field.sql` and
// `scripts/seed.mjs`, so every reader open-coded them. They're a contract between
// the migration, the seed, and now the read path, which is exactly the kind of
// thing that drifts silently — so they get a name.
//
// Deliberately tiny and dependency-free: it's imported by both server reads and
// client components, so it must not pull in the db.

// The `relations.role` used by the built-in Tags field. This is also the field's
// `key` in a type's property_schema — for a typed relation property the role IS
// the key (schema.md, `relations.role`), which is why one constant covers both.
export const TAGS_ROLE = "tags";

// The item type a tag is. `is_system = false` on purpose: the owner can rename it
// to "Topic", or delete it when unused, like any other type.
export const TAG_TYPE = "tag";
