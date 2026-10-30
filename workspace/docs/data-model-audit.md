# Arcane Codex data model audit

**Status:** Unified runtime implemented through SQLite schema version 14
**Scope:** The local-first Notion-style workspace in `workspace/`
**Primary goal:** Make an Arcane Codex page a durable, understandable, Markdown-centered document while retaining structured collections, assets, links, revisions, publication snapshots, discovery metadata, and a rich editor.
**Document role:** Sections describing the target and migration preserve the architectural reasoning that led to the cutover. The current-state and finding sections identify what schema v14 resolved and what remains open.

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
- Schema 13 separated editable drafts from explicit `private | unlisted | public` publication records and immutable published snapshots.
- Schema 14 replaced the article boolean with controlled page kinds (`page | note | article | project | fiction`) and added explicit summaries to drafts, snapshots, previews, and exports.
- Collection presentation no longer owns collection data: deleting an embedding page removes only its embed relationship.
- Discovery reads page kinds, summaries, explicit covers, collection membership, and publication state without moving or duplicating canonical pages.
- The normal runtime reads and writes only the unified schema. Pre-cutover backups remain the rollback mechanism.

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

`body_markdown` is the only persisted page body. `src/lib/documents/markdown.ts` owns Arcane Markdown version 1 normalization, validation, extension boundaries, reference extraction, plain-text extraction, and the one-time BlockNote conversion helpers. Standard content remains ordinary Markdown. Rich blocks use readable Markdown fallbacks plus deterministic `arcane-data` payloads.

BlockNote block objects exist only in editor memory. The runtime does not read or write a second canonical body format.

Current rich extensions include:

- `pageLink`, persisted as stable `arcane://page/<uuid>` Markdown links;
- `youtube`, with a readable external-link fallback;
- `gallery`, with ordinary image fallbacks;
- `artworkShowcase`, with image and prompt fallbacks;
- unknown blocks, preserved as versioned extension payloads rather than silently discarded.

### 1.3 Collections

Collections are independent resources:

- `collections` stores identity and display metadata;
- `collection_properties` stores normalized property definitions;
- `collection_items` joins canonical pages to collections;
- `collection_values` stores normalized typed values;
- `collection_views` stores reusable table/gallery views;
- `page_collection_views` embeds a view into one or more pages;
- `published_page_collection_views` snapshots public embeds independently from draft edits.

Collection rows remain ordinary canonical pages, so they retain full authored bodies, stable routes, publication state, and reusable membership.

### 1.4 Assets

Assets are content-addressed by SHA-256 and stored outside SQLite. Covers and icons have foreign keys. Body references use canonical `arcane://asset/sha256:<hash>` identifiers and are extracted from Markdown for health checks and export. A normalized `page_asset_refs` index is still absent, so referential queries and unused-asset analysis are derived rather than enforced by foreign keys.

### 1.5 Links and routes

Page identity is stable, while visible routes remain hierarchy-derived slug paths. Old paths are retained in `page_path_aliases`. Authored internal links use stable page IDs and `page_links` is derived from canonical Markdown. Child navigation and collection presentation are rendered outside authored bodies.

### 1.6 Export

`src/lib/data/export.ts` creates deterministic workspace or published ZIPs containing hierarchy-shaped Markdown, YAML frontmatter, relative page and asset links, content-addressed assets, collection CSV files, a manifest, and warnings. The published mode includes only explicit public snapshots and their referenced data.

Rich extensions retain readable standard-Markdown fallbacks plus optional Arcane metadata. The Hugo importer remains a one-off migration utility; reconstructing a workspace from exported Markdown is intentionally out of scope.

---

## 2. Observed workspace shape

A read-only structural check of the populated schema-v14 database at `/home/sumeet/matrix/data/arcane-codex-notion/workspace.sqlite` found:

- 88 page rows, of which 55 are active and 33 trashed;
- 88 publication rows, all currently private and without public snapshots;
- 95 assets;
- 4 independent collections and 31 collection memberships;
- 4 reusable collection views and 3 page/view embeds;
- no SQLite quick-check or foreign-key issues reported by `/api/health`.

Active documents include paragraphs, headings, quotes, lists, code blocks, tables, galleries, page links, YouTube, and an artwork showcase. Known rich blocks have readable Markdown fallbacks and deterministic extension payloads.

The original pre-cutover scan also recorded 448 BlockNote IDs and 15 double-encoded custom values. Those figures remain useful migration evidence but no longer describe canonical schema-v14 storage.

### Data directory contract

The ambiguity found during the audit is resolved. `ARCANE_WORKSPACE_DIR` is the exact directory containing `workspace.sqlite`, `assets/`, and `trash/`. `XDG_DATA_HOME` remains the default parent-root mechanism when the exact override is absent. `ARCANE_DATA_DIR` is retained only as a deprecated compatibility path.

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

### Resolved in schema v11 — canonical body contract

Canonical page bodies now live in `body_markdown`. Arcane Markdown version 1 is normalized and validated through `src/lib/documents/markdown.ts`; BlockNote JSON is no longer persisted.

### Resolved in schema v11 — export portability

Workspace and published exports use standard Markdown, relative links and assets, deterministic files, readable rich-block fallbacks, and explicit warnings. A general workspace importer remains intentionally out of scope.

### Resolved in schema v11 — authored versus derived content

Child navigation and collection rows are rendered outside the canonical body. Manually authored internal links remain part of Markdown and derived indexes can be rebuilt from source.

### Partially resolved — validation ownership

Create, update, migration, health, and export paths share Markdown helpers and storage-boundary validation. The current document module is deliberately small rather than the full typed AST and extension registry proposed below. New rich block types must still be reviewed across persistence, rendering, reference extraction, plain text, migration, and export.

### Resolved in schema v11 — structured extension payloads

Canonical extension payloads use deterministic structured JSON inside versioned `arcane-data` fences. Legacy stringified gallery and artwork values were normalized during migration.

### Resolved in schema v11 — stable internal links

Canonical authored page links preserve UUID identity through `arcane://page/<uuid>`. Rendering and export resolve the current route or relative file path, so page moves do not destroy identity.

### Open P1 — body asset references lack a relational index

Body asset IDs are extracted from canonical Markdown for validation, health checks, and export, but there is no normalized `page_asset_refs` table. Referential queries and unused-asset analysis are therefore derived rather than protected by foreign keys.

**Possible change:** derive `page_asset_refs` transactionally if queryability, garbage collection, or stronger integrity enforcement becomes necessary.

### Resolved for current blocks — Markdown fallbacks

Tables, YouTube, galleries, artwork showcases, files, media, images, page links, and unknown blocks all retain readable output. The remaining architectural risk is enforcement: registering a future editor block does not yet make persistence behavior impossible to omit.

### Resolved in schema v12 — independent collections

Collections, properties, values, views, and page embeds are independent resources. Deleting a presentation page removes the embed relationship rather than collection data, and one view can be embedded by multiple pages.

### Resolved in schema v13 — publication state

Per-page visibility and immutable published snapshots are stored separately, and the former global `publishedMode` setting has been removed. Draft saves cannot change published output.

### Resolved in schema v14 — discovery metadata

The article boolean was replaced by controlled page kinds, and explicit summaries were added to drafts, publication snapshots, previews, duplication, and export. Discovery can promote canonical pages without changing their hierarchy.

### Partially resolved — JSON metadata integrity

Collection property definitions and values are normalized. Tags remain in `tags_json`, while view presentation configuration may remain JSON because it is not identity-bearing domain data. Normalize tags only if topic-level querying and integrity justify the added model.

### Open P2 — floating sort keys

REAL sort keys and decimal insertion values can converge under repeated insertion.

**Possible change:** use integer sibling positions with transactional renumbering for this single-writer workspace, or a deliberate fractional-indexing string if synchronization becomes a real requirement.

### Open P2 — trash semantics

`trashPage()` marks one page and the schema can represent active descendants of trashed parents.

**Required decision:** define subtree trash and restore semantics, then enforce them transactionally.

### Resolved in schema v14 — duplication metadata

`duplicatePage()` copies kind and summary alongside tags, body, icon, and cover. Future page fields should be added through a centralized clone policy and regression test.

### Open P2 — full-text search

Search remains title-oriented despite pages being primarily textual documents.

**Possible change:** maintain an FTS5 index from title, Markdown plain text, summary, tags, and selected structured metadata.

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

## 15. Original cutover order

The core page, collection, publication, and discovery cutovers followed this sequence through schema v14. This list is retained as migration history; the unresolved items in section 4 now govern further data-model work.

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

Schema v14 has reached the intended foundation:

```text
SQLite workspace structure
+ canonical Markdown page bodies
+ independent structured collections
+ explicit publication snapshots
+ controlled discovery metadata
```

The editor is no longer the storage format, collection presentation no longer owns collection data, and public output no longer changes implicitly with draft edits. The next data-model decisions should be driven by real product needs rather than another wholesale rewrite.

The most consequential open questions are now narrower:

- whether topics/tags need a normalized first-class model for discovery;
- how curated homepage sections and manual ordering should be represented;
- whether body asset references need a relational index;
- what subtree trash/restore semantics should be;
- whether full-text search is valuable enough to justify FTS5;
- whether current floating sort keys should be replaced before synchronization is contemplated.

Homepage work should consume these domain concepts through reusable read models. It should not introduce homepage-only ownership, duplicate pages, or make hierarchy responsible for promotion.
