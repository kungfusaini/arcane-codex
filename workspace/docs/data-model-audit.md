# Arcane Codex data model audit

**Status:** Page and collection cutovers implemented through SQLite schema version 12
**Scope:** The local-first Notion-style workspace in `workspace/`
**Primary goal:** Make an Arcane Codex page a durable, understandable, Markdown-centered document while retaining structured collections, assets, links, revisions, and a rich editor.

## Executive decision

Arcane Codex should move from **BlockNote JSON as the canonical page body** to **Markdown as the canonical page body**.

SQLite should remain the transactional workspace database. It should own identity, hierarchy, ordering, publication state, collection membership, asset metadata, revision numbers, and derived indexes. Each page's authored body should be stored canonically as Markdown text in SQLite and exported as a complete Markdown document with YAML frontmatter.

This gives the application one authoritative body format without requiring a risky filesystem/database dual-write design. The exported documents should be maximally portable: useful as ordinary Markdown without Arcane Codex, with rich Arcane metadata treated as optional supplementary data.

The rich editor remains an interface over the document:

```text
canonical Markdown
  -> parse into Arcane document AST
  -> adapt AST to BlockNote blocks for editing
  -> adapt BlockNote blocks back to Arcane AST
  -> serialize deterministic Markdown
```

BlockNote is therefore an editor dependency, not the storage format.

## Implementation status

- Schema 11 completed the one-time page-body cutover to canonical Markdown and removed `content_json`.
- Schema 12 made collections independent resources, normalized property definitions and item values, and introduced reusable collection views plus page/view embeds.
- Collection presentation no longer owns collection data: deleting an embedding page removes only its embed relationship.
- The normal runtime reads and writes only the normalized schema. Pre-cutover backups remain the rollback mechanism.

## The most important rules

1. Authored page content and derived navigation must never be stored as the same thing.
2. Markdown text is canonical; BlockNote JSON is ephemeral editor state.
3. One parser/validator/serializer module owns the page format.
4. Every extension must have a readable Markdown fallback.
5. Export must preserve readable standard Markdown, relative links, assets, and graceful fallbacks; workspace import is not a product requirement.
6. Internal references use stable IDs and are rewritten to normal relative links on export.
7. Collection definitions are independent resources. Embedding a collection in a page must not make that page the collection's owner.
8. Validation belongs in the domain/storage boundary, not only in HTTP routes.
9. Derived indexes—backlinks, asset references, search text—must be rebuildable from canonical source.
10. Existing data must be migrated reversibly and retained until the new model is proven.

---

## 1. Current model

### 1.1 Page records

`src/lib/data/types.ts` and `src/lib/data/storage.ts` currently model a page as:

- stable UUID;
- parent UUID and floating-point sort key;
- title and sibling-unique slug maintained in application code;
- emoji or asset icon;
- cover asset and focal presentation values;
- controlled `kind` (`page | note | article | project | fiction`);
- explicit 240-character `summary` for previews;
- tags serialized into `tags_json`;
- canonical Markdown stored in `body_markdown`;
- optimistic concurrency revision;
- created, updated, and soft-delete timestamps.

The page tree and document body are stored separately. Child navigation and collection embeds are derived UI and are not injected into authored Markdown.

### 1.2 Body format

The server only establishes that `content_json` is a JSON array. It does not establish:

- a document format version;
- required block fields;
- known block types;
- valid custom block properties;
- valid asset references;
- valid page references;
- migration provenance.

Default BlockNote block structures and Arcane custom block structures are persisted directly. Current custom blocks are:

- `pageLink`;
- `youtube`;
- `gallery`;
- `artworkShowcase`.

Some values are JSON encoded a second time inside block props:

- `gallery.props.images` is a JSON string;
- `artworkShowcase.props.frameUrls` is a JSON string.

### 1.3 Collections

Collections currently consist of:

- `collections`, with JSON schema and view configuration;
- `collection_items`, joining pages to collections with JSON property values;
- an optional `host_page_id` on each collection.

Treating collection rows as pages is a strong choice. It means collection entries can have full authored bodies and stable links.

### 1.4 Assets

Assets are content-addressed by SHA-256 and stored outside SQLite. Covers and icons have foreign keys. References inside page bodies are only URL strings such as `/api/assets/<hash>`, so the database cannot enforce those references or safely determine whether an asset is unused.

### 1.5 Links and routes

Page identity is stable, but visible routes are hierarchy-derived slug paths. Old paths are retained in `page_path_aliases`. Backlinks are derived into `page_links` by walking `content_json`.

### 1.6 Export

`src/lib/data/export.ts` creates a deterministic ZIP with flat page files, assets, collection Markdown indexes, CSV files, and a manifest.

The export is readable but not a canonical interchange format:

- page files are flat rather than hierarchy-shaped;
- hierarchy is represented by opaque `parent_id` frontmatter;
- backlinks are appended as though they were authored body content;
- unsupported blocks are placed in JSON comments;
- collection schema/view fidelity is split between CSV and manifest behavior;
- BlockNote-to-Markdown conversion is custom and incomplete.

The Hugo importer is a one-off migration utility. A general Arcane workspace importer is intentionally out of scope.

---

## 2. Observed workspace shape

A read-only structural scan of the populated database at `/home/sumeet/matrix/data/arcane-codex-notion/workspace.sqlite` found:

- 88 page rows, of which 55 are active and 33 trashed;
- 95 assets;
- 3 hosted collections and 29 collection memberships;
- 30 backlink index rows;
- 76 path aliases;
- approximately 260 KB of page JSON;
- largest page body approximately 34 KB;
- no malformed page JSON;
- 448 persisted block IDs across active and deleted pages;
- 15 JSON-encoded custom property values.

Active documents include paragraphs, headings, quotes, lists, code blocks, a table, galleries, page links, YouTube, and an artwork showcase. The current Markdown exporter does not explicitly support tables, YouTube blocks, or artwork showcases.

Of 29 active `pageLink` blocks:

- 19 point to direct child pages and appear to be hierarchy-derived cards;
- 10 point elsewhere and appear to be authored references.

That distinction cannot be reliably reconstructed from the stored block itself. It is the clearest example of authored and derived content being mixed.

This scan is evidence about the current workspace, not a schema guarantee. A migration must still handle unknown and malformed records defensively.

### Data directory ambiguity

There are currently two database paths under the configured area:

- `/home/sumeet/matrix/data/arcane-codex-notion/workspace.sqlite` — populated;
- `/home/sumeet/matrix/data/arcane-codex-notion/arcane-codex/workspace.sqlite` — empty.

`getWorkspaceBaseDir()` always appends `arcane-codex` to `ARCANE_DATA_DIR`, while the root `.env.local` describes `ARCANE_DATA_DIR` as the workspace itself. The workspace `.env.local` describes it as a parent data root. This contract must be made unambiguous before migration so the wrong database cannot be migrated or newly initialized.

Recommended environment contract:

- `ARCANE_WORKSPACE_DIR`: exact directory containing `workspace.sqlite` and `assets/`;
- `XDG_DATA_HOME`: parent data directory used only when the exact override is absent.

Deprecate `ARCANE_DATA_DIR` with a startup warning and an explicit compatibility rule.

---

## 3. What is already good

The model should be evolved rather than discarded.

### Keep

- SQLite transactions and foreign keys;
- stable UUID page identity;
- optimistic revision checks;
- content-addressed asset files;
- soft deletion;
- path aliases;
- pages as collection entries;
- deterministic exports;
- integrity checks;
- explicit fallback behavior for unknown content;
- separate summary queries that avoid loading full bodies.

### Why SQLite should remain canonical for workspace structure

A filesystem-only tree looks attractive but makes these operations harder to keep atomic:

- moving or renaming nested pages;
- collection membership and typed values;
- aliases and redirects;
- optimistic concurrency;
- backlinks and search indexes;
- publication snapshots;
- asset metadata and garbage collection.

The ownership benefit of files can be achieved with a complete, deterministic, portable Markdown projection without making files and SQLite competing authorities.

---

## 4. Critical findings

### P0 — canonical body has no format contract

`content_json` is an unversioned vendor/editor structure. BlockNote upgrades or custom prop changes can reinterpret old content with no document migration boundary.

**Required change:** Introduce `body_markdown`, `body_format`, and `body_format_version`. Parse and validate through a central document module.

### P0 — export portability is incomplete

“Export to Markdown” should produce documents that remain useful in generic Markdown readers and static-site tools. Arcane-only blocks must not turn the export into opaque application data.

**Required change:** Use standard Markdown wherever possible, rewrite page and asset references to relative paths, and give every rich extension a complete human-readable fallback. A general workspace importer is not required.

### P0 — authored and derived content are mixed

`ensureChildPageLinkBlocks()` inserts child cards into the body. The API also removes some generated collection item links on reads. The same stored body can therefore be transformed according to external hierarchy and collection state.

Consequences:

- moving a child mutates the conceptual content of two parent pages;
- generated cards can become indistinguishable from deliberately inserted cards;
- API reads may not return stored source verbatim;
- backlinks include navigation relationships that are not authored references;
- exports can include generated navigation as article prose.

**Required change:** Render child navigation and collection rows as derived page components outside the canonical body. A manually authored page link remains ordinary authored Markdown.

### P0 — validation is fragmented

PATCH checks JSON shape and size; POST does not apply the same body checks. Scripts call storage functions directly and can bypass HTTP validation. Health checks only test JSON syntax.

**Required change:** Parse, validate, normalize, and size-check documents in a domain function called by every create, update, editor, and migration path.

### P1 — custom block data is double encoded

JSON strings inside JSON remove type safety and create multiple failure layers.

**Required change:** Custom extension nodes must use structured values in the AST. Their Markdown encoding must be deterministic and versioned.

### P1 — internal links are not uniformly identity-based

Custom page cards use page UUIDs, but ordinary links can store route paths. Backlink extraction only reliably recognizes explicit IDs and a narrow legacy `/page/<uuid>` form. Renames and moves therefore have different semantics depending on how the link was authored.

**Required change:** Canonical source should preserve page identity. Rendering/export can resolve the current route or relative file path.

### P1 — body asset references have no referential index

The application can validate icon and cover assets, but not assets embedded in page content. It cannot reliably identify unused files or all missing references.

**Required change:** derive `page_asset_refs` from canonical Markdown in the same transaction as a page save.

### P1 — Markdown support is incomplete

The current exporter lacks first-class handling for at least the table, YouTube, and artwork block types present in the populated workspace. It also has no parse/serialize property tests.

**Required change:** Every registered editor block must declare parse, serialize, render, reference extraction, plain-text extraction, and migration behavior.

### P1 — collections are owned by one host page

`collections.host_page_id` uses `ON DELETE CASCADE`. Deleting the presentation page can delete the structured collection itself. A collection can only have one host even though a Notion-like collection may have multiple linked views.

**Required change:** collections are independent; pages embed collection views by collection/view ID. Deleting an embed or page must not delete collection data.

### Resolved in schema v13 — publication state

Per-page visibility and immutable published snapshots are stored separately, and the former global `publishedMode` setting has been removed. Draft saves cannot change published output. Schema v14 replaces `isArticle` with controlled page kinds and adds explicit summaries to pages and publication snapshots.

### P2 — JSON metadata limits query integrity

`tags_json`, collection `schema_json`, `views_json`, and item `properties_json` are convenient but cannot be protected by ordinary foreign keys or indexed naturally.

Not every JSON field needs normalization. Tags and collection definitions are important enough to normalize. View layout configuration may remain JSON because it is presentation state.

### P2 — floating sort keys are fragile

REAL sort keys and decimal-concatenated timestamps are difficult to reason about and can converge under repeated insertion.

**Required change:** use integer sibling positions with transactional renumbering for this local workspace. A fractional indexing string is only justified if multi-writer sync is introduced.

### P2 — trash semantics are underspecified

`trashPage()` marks only one page. The schema permits active children of trashed parents, although the sampled workspace currently has none.

**Required change:** define subtree trash/restore behavior and enforce it transactionally.

### P2 — duplication is not complete

Schema v14 ensures `duplicatePage()` copies kind and summary alongside tags, body, icon, and cover.

**Required change:** centralize page cloning policy and test every field deliberately.

### P2 — search only searches title

The body format has no FTS index, despite pages being primarily textual documents.

**Required change:** maintain an FTS5 index from title, Markdown plain text, and selected structured metadata.

---

## 5. Target page contract

A page has four distinct categories of data.

### 5.1 Identity and structure

- `id` — immutable UUID;
- `parent_id` — structural parent, nullable;
- `position` — integer order among siblings;
- `slug` — current route segment;
- path aliases — derived historical route records.

### 5.2 Authored document metadata

- title;
- page kind (`page | note | article | project | fiction`);
- tags;
- icon;
- cover and cover presentation;
- canonical Markdown body.

### 5.3 Lifecycle metadata

- revision;
- created and updated timestamps;
- deleted timestamp;
- body format and version.

### 5.4 Derived data

- backlinks/outgoing links;
- body asset references;
- search text/index rows;
- child page navigation;
- collection previews;
- rendered HTML/cache.

Derived data is never exported as authored body content and can always be rebuilt.

---

## 6. Arcane Markdown format

### 6.1 Complete exported page

```markdown
---
arcane_format: 1
id: "018f4f2c-..."
title: "The Right Model"
slug: "the-right-model"
parent_id: "018f4e10-..."
position: 30
kind: article
visibility: private
tags:
  - AI
  - Coding Agents
icon:
  type: emoji
  value: "🧭"
cover:
  asset_id: "sha256:..."
  focal_x: 50
  focal_y: 35
  scale: 120
created_at: "2026-01-04T12:00:00.000Z"
updated_at: "2026-01-05T15:20:00.000Z"
revision: 12
---

There is a seemingly endless stream of models to choose from.

## Daily Driver

See [The Anatomy of AI Agents](arcane://page/018f4d9a-...).

![Benchmark chart](arcane://asset/sha256:abc123)
```

The database need not store this whole string. It should store queryable metadata in columns/tables and `body_markdown` without frontmatter. A document codec composes and decomposes the complete file. The complete file is the public data contract.

### 6.2 Standard Markdown first

Use CommonMark plus GFM for:

- paragraphs;
- headings;
- emphasis, strong, strike, inline code;
- links;
- images;
- block quotes;
- ordered, unordered, and task lists;
- fenced code blocks;
- thematic breaks;
- tables.

Prefer conventional Markdown even if the editor has a richer internal representation.

### 6.3 Internal page links

Canonical database Markdown uses a stable URI:

```markdown
[Readable label](arcane://page/018f4d9a-...)
```

On screen, the URI resolves to the current slug route. In a portable export, it is rewritten to a conventional relative `.md` path.

A standalone internal link may render as a page card. It does not require a distinct stored `pageLink` block.

This preserves ordinary Markdown syntax, stable identity, and readable degradation.

### 6.4 Assets

Canonical database Markdown uses:

```markdown
![Alt text](arcane://asset/sha256:abc123 "Optional caption")
```

File attachments use normal links. Export rewrites these to conventional relative asset paths.

Never store `/api/assets/...` as document source. API routes are a rendering concern.

### 6.5 YouTube

A standalone normal YouTube link is enough to express the content:

```markdown
[Video title](https://www.youtube.com/watch?v=fgT9zGkiLig)
```

The renderer may enhance a standalone supported URL into the player. This keeps the source portable and removes the need for a YouTube storage node. Timestamp links can remain URL fragments or use the video's standard `t=` URL.

### 6.6 Galleries

A gallery should retain readable standard images and use a small extension comment only for layout semantics:

```markdown
<!-- arcane:gallery {"version":1,"mode":"grid","imageSize":240,"caption":"Field studies"} -->

![First study](arcane://asset/sha256:aaa)

![Second study](arcane://asset/sha256:bbb)

<!-- /arcane:gallery -->
```

Without Arcane, this remains a sequence of images. With Arcane, the comment groups them and restores presentation. JSON in the comment must be canonicalized and schema validated. Unlike the current model, image records are not themselves JSON encoded inside another JSON document.

### 6.7 Complex custom widgets

A complex widget such as `artworkShowcase` should provide readable fallback Markdown followed by a fenced, versioned extension payload:

~~~~markdown
![Final artwork](arcane://asset/sha256:final)

> Prompt: A city dreaming beneath an orange sky.

```arcane-widget
{"type":"artwork-showcase","version":1,"frames":["sha256:f1","sha256:f2"],"speed":1}
```
~~~~

The exact delimiter can be finalized during the parser spike. The invariant is more important:

- visible fallback remains useful in generic Markdown;
- machine data is explicitly typed and versioned;
- references are stable IDs, not API URLs;
- unknown versions are preserved byte-for-byte and shown as unsupported, not discarded.

### 6.8 Child pages, backlinks, and collection rows

These are rendered outside `body_markdown`:

```text
page header
page metadata/properties
canonical authored Markdown body
optional derived child-page navigation
optional embedded collection views
optional backlink panel
```

They must not be silently inserted into Markdown during load or save.

---

## 7. Proposed SQLite schema

Names are illustrative; this should become migration 11 after the parser spike.

```sql
CREATE TABLE pages_v2 (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES pages_v2(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'page'
    CHECK (kind IN ('page', 'article')),
  body_markdown TEXT NOT NULL DEFAULT '',
  body_format TEXT NOT NULL DEFAULT 'arcane-markdown',
  body_format_version INTEGER NOT NULL DEFAULT 1,
  icon_emoji TEXT,
  icon_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  cover_focal_x REAL NOT NULL DEFAULT 50 CHECK (cover_focal_x BETWEEN 0 AND 100),
  cover_focal_y REAL NOT NULL DEFAULT 50 CHECK (cover_focal_y BETWEEN 0 AND 100),
  cover_scale REAL NOT NULL DEFAULT 100 CHECK (cover_scale BETWEEN 100 AND 200),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  CHECK (icon_emoji IS NULL OR icon_asset_id IS NULL)
);

CREATE UNIQUE INDEX pages_v2_live_sibling_slug
  ON pages_v2(COALESCE(parent_id, ''), slug)
  WHERE deleted_at IS NULL;

CREATE INDEX pages_v2_parent_position
  ON pages_v2(parent_id, position)
  WHERE deleted_at IS NULL;
```

SQLite cannot express every tree invariant as a simple constraint. Cycle prevention and subtree trash behavior remain transactional domain rules.

### Tags

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT
);

CREATE TABLE page_tags (
  page_id TEXT NOT NULL REFERENCES pages_v2(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (page_id, tag_id)
);
```

### Derived references

```sql
CREATE TABLE page_links_v2 (
  source_page_id TEXT NOT NULL REFERENCES pages_v2(id) ON DELETE CASCADE,
  target_page_id TEXT NOT NULL REFERENCES pages_v2(id) ON DELETE CASCADE,
  occurrence INTEGER NOT NULL,
  label TEXT,
  PRIMARY KEY (source_page_id, target_page_id, occurrence)
);

CREATE TABLE page_asset_refs (
  page_id TEXT NOT NULL REFERENCES pages_v2(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('body-image', 'attachment', 'widget')),
  occurrence INTEGER NOT NULL,
  PRIMARY KEY (page_id, asset_id, role, occurrence)
);
```

Do not invent a synthetic hash and call it `source_block_id` if blocks no longer have durable IDs. Store occurrences or source spans as derived diagnostics. If future comments or transclusion require stable block identity, add explicit anchors only to those blocks.

### Revisions

```sql
CREATE TABLE page_revisions (
  page_id TEXT NOT NULL REFERENCES pages_v2(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT 'autosave',
  PRIMARY KEY (page_id, revision)
);
```

Revision retention can be bounded. For example, retain explicit checkpoints and a sampled autosave history rather than every keystroke. The current optimistic `revision` remains the concurrency token.

### Search

Use FTS5 with derived plain text:

```sql
CREATE VIRTUAL TABLE page_search USING fts5(
  page_id UNINDEXED,
  title,
  body_text,
  tags
);
```

Rebuild it from canonical Markdown and normalized tags.

---

## 8. Collections target model

### 8.1 Independent collection identity

```sql
CREATE TABLE collections_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
```

There is no owning `host_page_id` and therefore no cascade from presentation to data.

### 8.2 Property definitions

```sql
CREATE TABLE collection_properties (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections_v2(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (collection_id, key)
);
```

`config_json` is appropriate for type-specific settings such as select options, colors, number formats, or date behavior. It must be validated according to `type`.

### 8.3 Membership and values

```sql
CREATE TABLE collection_items_v2 (
  collection_id TEXT NOT NULL REFERENCES collections_v2(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES pages_v2(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (collection_id, page_id)
);

CREATE TABLE collection_values (
  collection_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  property_id TEXT NOT NULL REFERENCES collection_properties(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL,
  PRIMARY KEY (collection_id, page_id, property_id),
  FOREIGN KEY (collection_id, page_id)
    REFERENCES collection_items_v2(collection_id, page_id)
    ON DELETE CASCADE
);
```

`value_json` remains practical for multiple property types, but each value is isolated and validated against one property definition. This is safer and more queryable than one unconstrained object per row.

### 8.4 Views and embeds

```sql
CREATE TABLE collection_views (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections_v2(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('table', 'gallery')),
  config_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL
);
```

A page embeds a collection view with an Arcane Markdown extension referencing the view ID. The same view or different views of one collection can appear on multiple pages. Removing the page or embed does not remove the collection.

---

## 9. Publication model

Do not overload page kind or workspace display mode.

Schema v13 implements one publication row per page. `visibility` is `private | unlisted | public`. Private rows have no snapshot; published rows contain an immutable copy of the page hierarchy, slug, metadata, Markdown body, source revision/timestamps, and publication timestamp. Publishing or updating publication replaces that snapshot explicitly; draft saves never mutate it. Unpublishing clears it.

This allows:

- an article that is still private;
- an ordinary page that is published;
- stable published output while the draft continues changing;
- intentional unpublishing;
- a build/deploy process independent of the editor UI.

Controlled `kind` and explicit `summary` metadata are included in publication snapshots. Published routes resolve exclusively against snapshots, public navigation includes only `public` pages, direct routes may resolve `unlisted` pages, and `private` pages return 404. A child cannot be published before its ancestors; a parent cannot be unpublished while it has published children. Published-app asset and collection access is filtered by published references. Export now has explicit `workspace` and privacy-filtered `published` modes.

---

## 10. Document module boundary

Create a framework-independent module, for example:

```text
src/lib/documents/
├── model.ts
├── parseMarkdown.ts
├── serializeMarkdown.ts
├── validate.ts
├── references.ts
├── plainText.ts
├── frontmatter.ts
├── blocknote/fromDocument.ts
├── blocknote/toDocument.ts
└── migrations/
```

Suggested contract:

```ts
type ArcaneDocument = {
  version: 1;
  blocks: ArcaneBlock[];
};

type ParseResult = {
  document: ArcaneDocument;
  diagnostics: DocumentDiagnostic[];
  preservedUnknownExtensions: UnknownExtension[];
};

parseMarkdown(source: string): ParseResult;
serializeMarkdown(document: ArcaneDocument): string;
validateDocument(document: ArcaneDocument): DocumentDiagnostic[];
extractReferences(document: ArcaneDocument): {
  pageIds: string[];
  assetIds: string[];
};
extractPlainText(document: ArcaneDocument): string;
```

The AST should be owned by Arcane Codex, ideally based on mdast types, rather than re-exporting BlockNote types. Block registration should be impossible without also registering persistence behavior.

```ts
type ArcaneExtension = {
  type: string;
  version: number;
  parse: (...args: unknown[]) => ArcaneBlock;
  serialize: (block: ArcaneBlock) => string;
  validate: (block: ArcaneBlock) => DocumentDiagnostic[];
  toBlockNote: (block: ArcaneBlock) => unknown;
  fromBlockNote: (block: unknown) => ArcaneBlock;
  references: (block: ArcaneBlock) => Reference[];
  plainText: (block: ArcaneBlock) => string;
};
```

This replaces the current situation where rendering and slash-menu registration exist, but export and reference behavior can be forgotten.

---

## 11. Save transaction

A page save should perform one domain operation:

1. check expected revision;
2. parse submitted Markdown or convert submitted editor AST;
3. validate all known syntax and extension schemas;
4. serialize deterministic canonical Markdown;
5. validate referenced pages and assets according to policy;
6. write the previous revision snapshot if retention policy requires it;
7. update page metadata/body and increment revision;
8. rebuild outgoing page links;
9. rebuild body asset references;
10. update FTS text;
11. commit;
12. return canonical source and the new revision.

Unknown extension syntax should normally be preserved with a diagnostic, not destroyed. Invalid references may be retained as broken links with warnings; malformed known extension payloads should fail the save unless explicitly stored as recovery source.

---

## 12. Migration plan

### Phase 0 — lock the target and protect the data

There is no need to create an application-level compatibility architecture for the current model. Treat the existing BlockNote JSON as migration input, not as a system that the new architecture must continue supporting.

Before changing storage:

- resolve the workspace path ambiguity;
- stop the application during the final migration;
- back up the populated database and complete assets directory;
- verify that the backup can be opened;
- capture row counts, asset hashes, hierarchy, references, and active/trash state;
- add sanitized fixtures for every observed block shape;
- freeze additions to the current block model.

Rollback means restoring the backup and previous application build. It does not mean maintaining two runtime models.

### Phase 1 — build the unified target vertically

Build the target architecture directly around Arcane Markdown:

```text
Next.js routes and React components
  -> application use cases
  -> domain contracts and document services
  -> repository interfaces
  -> SQLite/filesystem adapters
```

Create one canonical type vocabulary:

- `PageIdentity`;
- `PageMetadata`;
- `PageDocumentSource`;
- `PageSummary`;
- `PageDetail`;
- `PageRevision`;
- `Asset` and `AssetReference`;
- `Collection`, `CollectionProperty`, `CollectionItem`, and `CollectionView`;
- typed domain errors.

Create one implementation for every invariant, including title policy, tags, slugs, cover values, icon policy, Markdown size and validity, hierarchy, ordering, assets, and collection values.

Implement application use cases such as `CreatePage`, `UpdatePage`, `MovePages`, `TrashPageTree`, `DuplicatePage`, `CreateAsset`, and collection mutations. New API routes and scripts call these use cases. Do not first refactor old storage calls into a temporary architecture.

Implement explicit read models for the sidebar tree, page detail, collection detail, published pages, search, and export. Read models may combine canonical and derived data but never rewrite source.

### Phase 2 — implement and prove the Arcane document system

Implement the Arcane Markdown AST, parser, validator, deterministic serializer, reference extraction, plain-text extraction, and BlockNote adapters.

Prove every observed structure:

- paragraphs and inline styles;
- headings;
- quotes;
- bullet and ordered lists;
- code blocks;
- GFM tables;
- page links;
- images and files;
- galleries;
- YouTube links;
- artwork showcase;
- nested children;
- unknown blocks.

Required property:

```text
serialize(parse(serialize(parse(source)))) === serialize(parse(source))
```

Also prove semantic editor round trips:

```text
Arcane AST -> BlockNote -> Arcane AST
```

The extension registry must define the complete lifecycle of every extension: schema/version, validation, editor conversion, rendering, Markdown fallback, references, plain text, previews, and migration conversion.

### Phase 3 — write a one-time converter

Create a migration-only converter from the current block arrays to the new Arcane document model and Markdown. It may reuse narrowly scoped conversion helpers, but it is not imported by normal runtime code after migration.

For each existing page, produce a migration report containing:

- source JSON hash;
- resulting Markdown hash;
- diagnostics and unknown blocks;
- page and asset references before and after;
- plain-text comparison;
- generated child-card classification;
- whether manual review is required.

Confidently generated child navigation should be removed from authored bodies. Ambiguous links should be retained as authored links and listed for review. Unknown blocks must be preserved through a readable, versioned extension rather than dropped.

Run the converter repeatedly against disposable copies until every page either converts cleanly or has an explicitly approved diagnostic.

### Phase 4 — perform one atomic cutover

In maintenance mode and inside the safest practical transaction:

1. create the target tables;
2. convert all page bodies to canonical Markdown;
3. migrate normalized metadata and collection structures;
4. rebuild links, asset references, positions, and search indexes;
5. validate counts, hierarchy, references, hashes, and constraints;
6. abort the transaction on any unapproved discrepancy;
7. rename/swap target tables into place;
8. set the new schema version;
9. commit.

The resulting application reads and writes only the target model. Do not add dual-read columns, dual writes, fallback reads, or editor-load migrations.

The migrated database should not retain `content_json`. The verified external backup and migration report are the recovery artifacts.

### Phase 5 — switch the entire application together

Update the editor, API, export, collection previews, backlinks, search, publishing reads, and tests to use the unified target services in the same cutover release.

Acceptance criteria:

- one shared definition exists for every page and collection contract;
- runtime code has no `content_json` concept;
- runtime code does not understand old BlockNote persistence shapes;
- all mutations pass through application use cases;
- API routes contain transport concerns rather than domain policy;
- all extension types pass registry completeness tests;
- export produces standard relative links, assets, and readable fallbacks;
- child navigation and backlinks are derived, never injected into authored source;
- private and published surfaces use shared read models;
- migration verification and Markdown portability tests pass.

### Phase 6 — remove the converter

After the migrated workspace and backup have both been verified:

- remove the one-time converter from shipped runtime code;
- retain the migration report with the backup;
- optionally retain the converter as an offline historical script or commit, not as an application dependency;
- continue forward with only the unified model.

---

## 13. Required tests

### Document fixtures

One fixture per standard block and extension. Every fixture tests parse, validate, serialize, reference extraction, plain text, and BlockNote adaptation.

### Golden Markdown tests

Expected Markdown files should be reviewed like source code. Avoid only testing with regular-expression fragments.

### Property tests

Generate combinations of standard blocks and assert deterministic parse/serialize idempotence.

### Export portability

Open golden exports with generic Markdown tooling and verify:

- prose, headings, lists, tables, quotes, and code remain conventional Markdown;
- page links are relative `.md` links;
- asset links are relative paths;
- rich blocks retain useful visible fallback content when Arcane metadata is ignored;
- no API route or local absolute path leaks into exported content;
- repeated exports of unchanged data remain byte-identical.

### Migration tests

Run migration against a sanitized copy of the observed database and assert:

- page count unchanged;
- active/trash state unchanged;
- hierarchy unchanged;
- titles and metadata unchanged;
- no asset bytes changed;
- all current blocks represented or preserved as unknown extensions;
- no body is empty unless the original was empty;
- references are equal or differences are listed in a reviewed report.

### Failure tests

- malformed frontmatter;
- malformed known extension payload;
- unknown extension version;
- missing page target;
- missing asset;
- duplicate sibling slug;
- stale revision;
- page exceeding size limit;
- cyclic parent move;
- trashing/restoring a subtree;
- interrupted migration.

---

## 14. Decisions still requiring product input

These should be decided before implementation, but they do not block the architecture recommendation.

1. **Hierarchy-shaped exports or stable flat files?**
   - Recommended: hierarchy-shaped directories for human browsing, with stable IDs in frontmatter and a manifest.
   - Moving a page then moves its exported file, which is expected.

2. **Page file naming:** `slug.md` or `slug--short-id.md`?
   - Recommended: `slug.md` when sibling slugs are unique; ID remains in frontmatter.
   - The manifest resolves identity and collisions.

3. **Revision retention policy:**
   - Recommended: keep explicit checkpoints plus hourly/daily sampled autosaves; always keep the pre-migration legacy source until migration is finalized.

4. **Unknown widgets on save:**
   - Recommended: preserve and render a warning; only reject malformed payloads for known widget types.

5. **External filesystem editing:**
   - Out of scope. Exported Markdown is portable output, not a synchronized source tree.

---

## 15. Recommended implementation order

1. Resolve the exact workspace directory contract and make a verified backup.
2. Capture current-data invariants and sanitized fixtures for every observed block.
3. Define the final domain contracts, use cases, repository boundaries, and read models.
4. Build the Arcane Markdown AST, parser, serializer, validation, and reference extraction.
5. Build the complete extension registry and BlockNote adapters.
6. Implement the target SQLite repositories, transaction coordinator, and schema.
7. Implement target page, asset, collection, publication, search, and export services.
8. Write the isolated one-time JSON-to-Markdown converter and migration report.
9. Rehearse migration against disposable database and asset copies until there are no unapproved differences.
10. Add Markdown portability, deterministic export, and editor/document semantic round-trip tests.
11. Stop the application and perform the atomic schema/data cutover.
12. Validate the migrated workspace against the captured invariants.
13. Deploy the application with only the unified target model.
14. Remove the converter from runtime code and retain it only with the migration record if desired.

---

## Final assessment

The existing database is a sound local-first foundation, but `content_json` currently makes the editor implementation the page format. That is the wrong dependency direction for a durable personal knowledge system.

The target should be:

```text
SQLite workspace structure + canonical Markdown page bodies + typed extension grammar
```

—not:

```text
SQLite + opaque editor JSON + best-effort Markdown export
```

This preserves the strengths already present—transactions, stable identities, assets, revisions, collections, aliases—while making each page understandable, portable, testable, and much closer to the way a Markdown document is naturally organized.
