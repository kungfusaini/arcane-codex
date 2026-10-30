# Arcane Codex content model

**Status:** Accepted foundation; implementation pending
**Applies to:** Canonical pages, collections, projects, artifacts, publication, and future discovery surfaces
**Last reconciled:** 2026-10-30

## Purpose

Arcane Codex needs a small, stable ontology that can represent writing, reference material, personal notes, structured cultural collections, and interactive projects without forcing one hierarchy to carry every meaning.

The model separates six questions:

1. What role does this page play?
2. What subject is it about?
3. Which structured collections include it?
4. Which projects relate to it?
5. Which artifacts belong to those projects?
6. Who can see the current published snapshot?

Only the first question is answered by a page class. Topics, collection membership, project relationships, artifacts, maturity, publication, and homepage promotion remain independent.

## Core invariant

Every canonical page has exactly one core class:

```text
Space | Entry | Note | Work
```

These classes describe the page's primary role in Arcane Codex. They do not describe its topic, location, visibility, maturity, literary format, or relationship to a project.

## Core classes

### Space

A Space organises or presents other Codex material.

Typical characteristics:

- acts as a hub, section, dashboard, or navigation surface;
- commonly contains child pages, collection views, or discovery views;
- may contain introductory prose;
- is not primarily intended to be encountered as an individual authored item in a writing feed.

Examples:

- Arcane Codex
- Matrix
- AI
- Library
- Life
- Cinema
- Jukebox

A Space can be public or private. Being a Space does not make its descendants public.

### Entry

An Entry primarily represents an external or catalogued subject.

Typical characteristics:

- commonly belongs to a structured collection;
- identity comes from the represented thing rather than from a standalone authored argument;
- may contain metadata, quotations, annotations, ratings, factual context, or informal thoughts;
- remains useful even when its authored body is empty.

Examples:

- a book in Library;
- a film in Cinema;
- a song or classical piece in Jukebox;
- a person, place, tool, or other future catalogued subject.

An Entry may contain writing directly. If a reflection develops an independent title, argument, form, or reason to be linked and published separately, it should usually become a related Note or Work rather than changing the subject Entry into the authored piece.

### Note

A Note is an intentionally note-like unit of authored thought.

Typical characteristics:

- exploratory, fragmentary, informal, observational, or narrowly scoped;
- may be short or long;
- may be complete without becoming a Work;
- can relate to Entries, Projects, collections, topics, or other pages.

Examples:

- Artists First?
- a quick response to a song;
- a research fragment;
- an experiment log;
- an unfinished line of inquiry.

A Note is not merely an unfinished Work. It is a distinct authored form. A Note may later be promoted into a Work when its intended role genuinely changes, or it may remain as source material for a separate Work.

### Work

A Work is an intentional authored creation with an identity of its own.

Typical characteristics:

- intended to be encountered as a distinct piece;
- has a title, form, and authored purpose;
- may be draft, revising, complete, private, unlisted, or public;
- may relate to an Entry or Project without becoming subordinate data owned by it.

Examples:

- an essay;
- a technical article;
- fiction;
- a poem;
- a finished project write-up;
- a substantial cultural reflection.

Work does not mean published or complete. Maturity and visibility are separate dimensions. Literary and editorial formats such as essay, fiction, poem, review, or dispatch will be modelled beneath Work only after those formats are decided.

## Classification test

Classify a page by asking these questions in order:

1. **Is its primary job to organise or present other Codex material?**
   - Yes: Space.
2. **Does it primarily represent an external or catalogued subject that remains meaningful without authored prose?**
   - Yes: Entry.
3. **Is it an intentional standalone authored creation with its own identity?**
   - Yes: Work.
4. **Otherwise, is it an authored thought, fragment, observation, or working document?**
   - Yes: Note.

When two answers appear valid, choose the page's primary identity and represent the other meaning through a relationship. Do not duplicate the page merely to satisfy multiple navigation surfaces.

## Orthogonal concepts

### Hierarchy

Hierarchy answers where a page lives in the private workspace. It does not decide page class, public navigation, collection membership, project membership, or homepage promotion.

A deeply nested Work may be featured publicly. A top-level Space may remain private.

### Collections

Collections provide structured membership and domain-specific properties.

Examples:

- Library: author, rating, reading status;
- Cinema: director, year, viewing status;
- Jukebox: artist or composer, release or composition data, listening status;
- a Classical Music collection: composer, period, year, famous or landmark classification.

A collection may contain Entries, Notes, or Works. Collection membership does not determine class.

Page-owned metadata such as title, summary, cover, class, publication state, and path aliases must not be duplicated as collection properties.

### Projects

Project is not a page class.

A Project is an independent undertaking that may relate:

- Spaces used to organise it;
- Entries used as its structured subjects;
- Notes produced during the work;
- Works produced from or about the work;
- Collections used by the project;
- runnable or external Artifacts.

Pages and Projects have a many-to-many relationship. A page may relate to no Project, one Project, or several Projects. Whether every Project needs a designated home page remains undecided.

### Artifacts

An Artifact is a concrete output or runnable surface associated with a Project, such as:

- an interactive application;
- a source repository;
- a generated gallery;
- a downloadable file;
- a physical object;
- a deployed website.

An Artifact is not automatically a page. A Work may explain it, a Space may present it, and a Project may group it with other outputs.

### Maturity

Draft, revising, and complete describe maturity, not class. The maturity vocabulary and whether it should be explicitly persisted remain undecided.

### Publication

`private | unlisted | public` controls visibility and published snapshots. Publication does not change class, maturity, collection membership, or project relationships.

### Topics and formats

Topics answer what a page concerns. Formats describe the form of a Work. Neither is a core class.

Their exact vocabularies and persistence models remain open. Adding a topic or Work format must not require adding a new core class.

### Curation

Homepage placement, featured status, manual ordering, and discovery shelves are presentation decisions. They must refer to canonical pages and Projects rather than own duplicate content.

The homepage model remains open until the page, Project, and relationship foundations are implemented.

## Representative models

### AI Emoji Generator

```text
Project: AI Emoji Generator
Work: AI Emoji Generator write-up
Artifacts:
  - generator application
  - source repository
  - generated image gallery
Related Notes:
  - prompt experiments
  - visual-style observations
```

The existing AI Emoji Generator page is provisionally a Work. The Project and its Artifacts are separate identities even if the Work later serves as the public project home.

### Journey Through Classical Music

```text
Project: Journey Through Classical Music
Space: optional project workspace or public landing surface
Collection: classical works
Artifact: interactive timeline/viewer
Entries: catalogued classical pieces
Notes: listening observations and developing thoughts
Works: finished essays, criticism, fiction, or poetry inspired by the journey
```

A Moonlight Sonata page can appear in Jukebox while also relating to the Classical Music Project. If it primarily represents the composition, it is an Entry. A quick personal response can be a related Note; a finished critical essay can be a related Work. For a lightweight workflow, informal writing may remain directly inside the Entry until it deserves an independent identity.

## Current active-page classification

The populated schema-v14 workspace currently has 55 active pages. The proposed migration classifies them as follows.

### Spaces — 11

- Arcane Codex
- Matrix
- Aether
- AI
- AI Image gen experiments
- Tools
- Neovim
- Library
- Life
- Cinema
- Jukebox

### Entries — 25

- Lord of the Flies
- 1984
- Post Office
- Lolitas
- A Clash of Kings
- A Game of Thrones
- 12 Rules for Life
- The Richest Man in Babylon
- Fahrenheit 451
- The Hobbit
- Meditations
- Notes from Underground
- Kim
- Atomic Habits
- Alice's Adventures in Wonderland
- The Curious Case of Benjamin Button
- Humble Pi
- Star Maker
- Across the River and into the Trees
- A Clockwork Orange
- Requiem for a Dream
- Conspicuous Consumption
- Perfume
- Jane Eyre
- Industrial Society and its Future

These are Library subjects even when they contain substantial quotations or reading notes.

### Notes — 2

- Artists First?
- Drive

`Drive` is provisionally a Note because its primary purpose is Sumeet's informal response to the song, while Jukebox membership supplies the musical context.

### Works — 17

- Building Aether
- Nginx Reverse Proxy
- The Missing Skills of Vibe Coders
- AI Makes You Think Like a Tech Lead
- The Anatomy of AI Agents
- The Right Model
- Markdown Rendering Issue
- The Importance of Having Your Own Tools
- The Path to a More Flexible Life
- How a Motorcycle Changed My Life
- Structuring a Free Life
- Preparing for a Nomadic Life
- Metamorphosis
- The Alchemist
- The Shining
- AI Emoji Generator
- Suffer For Your Art

AI Emoji Generator and Suffer For Your Art are provisionally Works because their current pages read as substantial authored experiment write-ups. Their related applications should be Artifacts of corresponding Projects.

## Expansion rules

A new core class may be introduced only when all of the following are true:

1. existing classes cannot describe the page's primary role without distortion;
2. the distinction changes durable behaviour across storage, editing, publication, or discovery;
3. the case cannot be represented as a Topic, Work format, collection membership, Project relationship, Artifact, maturity state, or curation rule;
4. several real examples require it;
5. the migration and backward compatibility are explicit.

Do not add a core class merely for a new genre, subject, media type, collection, project type, or homepage section.

## Accepted decisions

- Every canonical page has one core class.
- The stable core-class vocabulary is Space, Entry, Note, and Work.
- Project is an independent entity, not a page class.
- Pages and Projects have a many-to-many relationship.
- Pages may belong to multiple collections independently of Project relationships.
- Classical piece pages must be able to appear in Jukebox while relating to the Classical Music Project.
- Artifacts such as the classical viewer or emoji generator are outputs associated with Projects, not page classes.
- Note versus Work describes authored role, not merely unfinished versus finished.

## Open decisions

Decide these individually before implementing them:

1. Whether every Project has a designated home page.
2. The minimum Project fields and lifecycle.
3. Project-page relationship roles, if any.
4. The Artifact contract and whether Artifacts need first-class persistence initially.
5. Work formats and their controlled vocabulary.
6. Whether maturity needs an explicit persisted status.
7. Topic normalization and topic-page behaviour.
8. Homepage curation and reusable discovery views.

## Implementation boundary

This document records the accepted ontology but does not authorize or perform a database migration.

A future schema-v15 change should deliberately update:

- draft and publication page class fields;
- create, update, duplicate, migration, and validation paths;
- editor controls and labels;
- discovery read models;
- previews and exports;
- tests and fixtures;
- the 55-page populated workspace using the reviewed mapping above.

No Work-format, maturity, Project, Artifact, Topic, or homepage schema should be introduced until its corresponding open decision is settled.
