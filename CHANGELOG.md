# Changelog

## 0.4.0

- Open a vertical row-details modal on double-click or Enter, including read-only fields.
- Apply all changed fields as one validated, undoable command; preserve protected columns and staged saving.
- Preserve unsent modal values on validation errors, support Escape to cancel and Ctrl/Cmd+Enter to apply.
- Migrate 0.3.x hot-exit drafts to grouped history without losing undo/redo.
- Add real extension screenshots to the English and Portuguese READMEs.

## 0.3.1

- Add a dedicated database icon to the extension listing and Marketplace packages, using the publisher's navy palette.

## 0.3.0

- Add typed cell editing for real tables with a non-null, safely represented primary key.
- Add staged Undo, Redo, Save and Discard controls, and keyboard shortcuts for grid history.
- Integrate pending changes with VS Code Save, Revert, close prompts and hot-exit draft backup.
- Save edits atomically with foreign-key enforcement, row/schema conflict detection and a consistent SQLite backup before every write batch.
- Protect primary keys, generated columns, BLOB cells, unsafe integers, views and arbitrary query results.
- Prepare the public Marketplace identity `lfcontato.sqlite-explorer-local` and English/Portuguese documentation.

## 0.2.0

- Add the database tree to the file explorer, session restoration and table opening to the side.
- Add a database-root context menu for independent SQL query tabs, including JOINs and CTEs.
- Add English and Portuguese localization.

## 0.1.0

- Initial local release: SQLite custom editor, schema tree, paged tables, filtering, sorting, read-only queries and CSV/JSON export.
