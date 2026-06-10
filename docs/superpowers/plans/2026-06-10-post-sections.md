# Post Sections Implementation Plan

## Checklist

1. Add schema migration and update the canonical local schema.
2. Extend shared types and the D1 repository with section records, scoped published filters, and scoped tags/categories.
3. Add public endpoints for section navigation and section-scoped post lists.
4. Add admin endpoints for section CRUD, ordering, deletion confirmation, and per-post assignment.
5. Extend the Posts admin UI with the section settings panel and post section selector.
6. Extend the public header and Home route so top-level section paths render scoped post lists.
7. Add tests for repository behavior, public API behavior, admin API behavior, admin UI behavior, public routing/UI behavior, and sync preserving `section_id`.
8. Run full verification, inspect styling with Playwright, deploy, commit, and push.

## Notes

- Section assignment is independent from Notion metadata and native local post draft content.
- Home remains the no-section feed.
- Search, archive, RSS, sitemap, and post detail remain global unless a future feature explicitly changes them.
