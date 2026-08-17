# Arcane Codex

A private, local-first page and collection workspace. Data stays in an XDG workspace directory; there is no account, cloud sync, AI service, or public sharing surface.

## Local data

By default Arcane Codex stores data under:

```text
${XDG_DATA_HOME:-~/.local/share}/arcane-codex/
├── workspace.sqlite
├── assets/
└── trash/
```

Set `XDG_DATA_HOME` before starting the app to choose another XDG data root. Tests and isolated deployments can set `ARCANE_DATA_DIR` to override the data root for the whole workspace.

## Export

Use **Export ZIP** in the sidebar or send `POST /api/export`. The deterministic archive contains:

- active pages as Markdown with YAML frontmatter;
- relative page and asset links;
- content-addressed assets;
- one CSV per collection;
- `manifest.json` with stable paths, metadata, and warnings;
- an export `README.md` describing the snapshot.

Repeated exports of an unchanged workspace are byte-identical. Missing references and unsupported editor blocks remain readable and are listed as warnings. Deleted pages and full revision history are intentionally excluded.

## Recovery and integrity

Arcane Codex runs SQLite quick and foreign-key checks whenever the workspace opens. The sidebar reports missing assets, unregistered asset files, and malformed page or collection JSON through `/api/health`.

If a health warning appears:

1. Stop Arcane Codex.
2. Copy the entire workspace directory before changing anything.
3. Export the workspace if export is still available; raw/fallback content and warnings can aid recovery.
4. Restore `workspace.sqlite` or `assets/` from a known-good backup, or re-upload only the files reported missing.
5. Restart and select **Run check again**.

Do not delete unregistered asset files until their origin is understood.

The editor keeps an unsaved recovery draft in browser local storage until the server confirms a save. On a stale revision, Arcane Codex never silently overwrites either version: choose **Load latest saved page** or **Save my draft over latest**. A browser draft found after restart can be restored or discarded explicitly.

Uploads are limited to 20 MB and validated by filename extension, declared MIME type, and file signature. Supported formats are PNG, JPEG, GIF, WebP, PDF, UTF-8 text, and Markdown; SVG and mismatched files are rejected.
