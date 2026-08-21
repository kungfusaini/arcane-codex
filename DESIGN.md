---
version: alpha
name: Arcane Codex
description: Dark, dense, content-first local workspace with quiet Notion-calibrated chrome.
colors:
  primary: "#1f78d1"
  primary-on: "#ffffff"
  neutral: "#191919"
  neutral-ink: "#f1f1ef"
  neutral-muted: "#d2d2cf"
  neutral-border: "#353535"
  panel: "#252525"
  rail: "#202020"
  field: "#2c2c2c"
  success: "#4dab9a"
  warning: "#dca65c"
  danger: "#eb5757"
  danger-container: "#3a2426"
  shadow: "rgba(0, 0, 0, 0.34)"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: -0.03em
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
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
    width: 264px
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

A dark, dense, content-first local workspace calibrated to the supplied Notion reference. The document, cover, and structured data carry the visual identity; application chrome stays quiet and contextual.

## Implementation Source

The canonical runtime token source is `src/styles/theme.css`. It owns primitives plus semantic, state, component, layout, media/player, image-tool, card, popover, and collection/gallery aliases. Product CSS may be split by surface, but visual values must flow through those tokens rather than being redefined per component.

## Component Coverage

The theme contract covers the app shell, sidebar/tree navigation, document/page/editor surfaces, BlockNote overrides, collections table/gallery/settings/forms, image grabber and image editing popovers, gallery blocks, page media controls, inline YouTube embeds, mini music player dock, menus/popovers, skeleton/loading/empty/no-results/error states, and mobile drawer/bar behavior.

## Colors

- `neutral` is the continuous document canvas.
- `page` separates the navigation rail without a decorative border.
- `card` is reserved for temporary raised surfaces such as menus and popovers.
- `page-muted` provides hover and selected states.
- `accent` is the only strong interface colour and is reserved for focus, links, selection, and primary creation.
- Content images, emoji, and user-authored property values may carry their own semantic colour.

## Typography

Use the system sans family throughout navigation, titles, editing, and collections. Hierarchy comes from weight, density, and placement rather than a contrasting display face. Page titles use the scale; controls never invent smaller or larger one-off sizes.

## Layout

The 264px desktop rail is persistent and compact. The main canvas is continuous and unframed. Covers run full width; the page icon overlaps the cover edge; documents use a readable measure while hosted collections may expand to the available width. On narrow screens the rail becomes a focus-managed drawer and content remains primary.

## Elevation

Use named elevation levels only. Core surfaces remain flat. Elevation is permitted for temporary menus, popovers, drawers, and recovery overlays; it is not texture.

## Shapes

Use small radii. Dense rows and the document canvas do not become cards. Hairline dividers are allowed for table structure and section boundaries only.

## Motion

- Use 100–200ms motion for drawer continuity, menu/popover opening, selection, drag/reorder feedback, and state changes.
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
- Do not use warm paper, serif display type, moss accents, gradients, glow, glass effects, decorative borders, fake metrics, or filler copy.
- Do not expose raw administration forms in the primary work surface.
