---
version: alpha
name: Arcane Codex
description: Gruvbox-dark, dense, content-first local workspace with ProFont chrome, orange accent, and a veiled arcane artwork backdrop.
colors:
  primary: "#af3a03"
  primary-on: "#fbf1c7"
  neutral: "#1d2021"
  neutral-ink: "#ebdbb2"
  neutral-muted: "#ebdbb2"
  neutral-border: "#504945"
  panel: "#3c3836"
  rail: "#282828"
  field: "#504945"
  success: "#b8bb26"
  warning: "#fabd2f"
  danger: "#fb4934"
  danger-container: "#3c2826"
  shadow: "rgba(0, 0, 0, 0.42)"
typography:
  body:
    fontFamily: "Arcane ProFont, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Arcane ProFont, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Arcane ProFont, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Arcane ProFont, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: -0.03em
  display:
    fontFamily: "Arcane ProFont, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: -0.03em
  mono-label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.1
spacing:
  none: 0px
  hairline: 1px
  micro: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px
  5xl: 80px
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 8px
components:
  body:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.body}"
  sidebar:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.neutral-ink}"
    width: 336px
  document:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.neutral-ink}"
    width: 768px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-on}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 8px
    height: 32px
  button-danger:
    backgroundColor: "{colors.danger-container}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 8px
    height: 32px
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 8px
    height: 32px
  popover:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.neutral-ink}"
    rounded: "{rounded.md}"
    padding: 8px
  media-player:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.neutral-ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    width: 560px
  publish-media-modal:
    scrimColor: "color-mix(in oklab, {colors.neutral} 96%, transparent)"
    panelBackgroundColor: "transparent"
    panelShadow: "none"
    rounded: "{rounded.md}"
  collection-token-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.neutral}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  collection-token-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.neutral}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  collection-token-muted:
    backgroundColor: "{colors.neutral-muted}"
    textColor: "{colors.neutral}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  divider:
    backgroundColor: "{colors.neutral-border}"
    height: 1px
  shadow-reference:
    backgroundColor: "{colors.shadow}"
    size: 1px
---
# Arcane Codex Design System

## Overview

A Gruvbox-dark, dense, content-first local workspace calibrated to the approved theme specimen. ProFont, orange accent marks, and a veiled artwork backdrop carry the visual identity; application chrome stays compact and contextual.

## Implementation Source

The canonical runtime token source is `src/styles/theme.css`. It owns primitives plus semantic, state, component, layout, media/player, image-tool, card, popover, and collection/gallery aliases. Product CSS may be split by surface, but visual values must flow through those tokens rather than being redefined per component.

## Component Coverage

The theme contract covers the app shell, sidebar/tree navigation, document/page/editor surfaces, BlockNote overrides, collections table/gallery/settings/forms, image grabber and image editing popovers, gallery blocks, the publish media modal baseline for opened images/future rich media, page media controls, inline YouTube embeds, mini music player dock, menus/popovers, skeleton/loading/empty/no-results/error states, and mobile drawer/bar behavior.

## Colors

- `neutral` is the dark Gruvbox canvas, veiled over the artwork backdrop.
- `page` separates the navigation rail without a decorative border.
- `card` is reserved for temporary raised surfaces such as menus and popovers.
- `page-muted` provides hover and selected states.
- `accent` is the only strong interface colour and is reserved for primary creation, active marks, branches, and selection accents.
- Content images, emoji, and user-authored property values may carry their own semantic colour.
- Published images open in the shared media modal baseline: a darker page scrim with a transparent media panel so the opened media, not a card, dominates. Future video, 3D, or other rich media viewers should reuse the same modal shell before adding type-specific controls.

## Typography

Use Arcane ProFont throughout navigation, titles, editing, and collections. Hierarchy comes from weight, density, and placement rather than a contrasting display face. Page titles use the scale; controls never invent smaller or larger one-off sizes.

## Layout

The 336px desktop rail is persistent and compact, giving nested page titles enough room before truncation. When collapsed on desktop, the rail slides out on the inline axis while the grid track closes so the main canvas shifts into the freed space instead of being covered. The main canvas is continuous and unframed. Covers run full width; the page icon overlaps the cover edge; documents use a readable measure while hosted collections may expand to the available width. Gallery images use one selected slider-controlled image size across the block, bounded by theme min/default/max sizing tokens; grid columns are dynamic and fit as many same-size images as the available width allows. On narrow screens the dynamic grid collapses to preserve usable image proportions. On narrow screens the rail becomes a focus-managed drawer and content remains primary.

## Elevation

Use named elevation levels only. Core surfaces remain flat. Elevation is permitted for temporary menus, popovers, drawers, and recovery overlays; it is not texture.

## Shapes

Use small radii. Dense rows and the document canvas do not become cards. Hairline dividers are allowed for table structure and section boundaries only.

## Motion

- Use 100–200ms motion for drawer continuity, desktop rail collapse/restore, menu/popover opening, selection, drag/reorder feedback, and state changes.
- High-frequency editor and table actions should feel immediate.
- Prefer opacity and transform; never use `transition: all`.
- No route-wide entrances, repeated row staggers, bounce, glow, or decorative animation.
- `prefers-reduced-motion` preserves state while removing nonessential movement.

## Components and States

Every interactive element defines default, hover where applicable, focus-visible, active, and disabled states. Data surfaces also define loading, empty, no-results, error, populated, saving, and recovery states. Touch interactions must not depend on hover.

## Do's & Don'ts

- Do let the cover, page icon, writing, and property values provide visual richness.
- Do use progressive disclosure for media, administration, and destructive actions.
- Do keep one obvious primary action per region.
- Do not frame the editor, page, collection, or navigation groups as cards.
- Do not use warm paper, blue accents, moss accents, glow, glass effects, decorative borders, fake metrics, or filler copy.
- Do not expose raw administration forms in the primary work surface.
