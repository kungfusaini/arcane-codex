# Arcane Codex

Arcane Codex is now organized as a small monorepo with two related projects:

- [`site/`](site/) — the existing Hugo-powered public website.
- [`workspace/`](workspace/) — the local-first Notion-style Arcane Codex workspace app.

## Site

```sh
cd site
hugo server
```

## Workspace

```sh
cd workspace
npm install
npm run dev
```

The workspace stores local data outside the repo by default. See [`workspace/README.md`](workspace/README.md) for details.
