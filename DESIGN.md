---
colors:
  neutral: "#191919"
  neutral-ink: "#f1f1ef"
  neutral-muted: "#d2d2cf"
  neutral-border: "#353535"
  accent: "#1f78d1"
  accent-on: "#ffffff"
  shadow: "rgba(0, 0, 0, 0.34)"
  success: "#4dab9a"
  warning: "#dca65c"
  danger: "#eb5757"
  danger-muted: "#3a2426"
  card: "#252525"
  page: "#202020"
  page-muted: "#2c2c2c"

typography:
  family:
    base: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    display: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  scale:
    100: "12px"
    200: "14px"
    300: "16px"
    400: "18px"
    500: "20px"
    600: "24px"
    700: "32px"
    800: "48px"

spacing:
  0: 0
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
  16: 64px

rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 8px

motion:
  easing:
    primary: "cubic-bezier(0.23, 1, 0.32, 1)"
    secondary: "cubic-bezier(0.77, 0, 0.175, 1)"
  duration:
    fast: 100ms
    standard: 150ms
    slow: 200ms
  distance:
    small: 2px
    medium: 4px

elevation:
  none: "none"
  sm: "0 1px 2px var(--shadow)"
  md: "0 8px 24px var(--shadow)"
  lg: "0 16px 40px var(--shadow)"
  xl: "0 24px 64px var(--shadow)"

components:
  body:
    background: "var(--color-neutral)"
    color: "var(--color-ink)"
    font-family: "var(--font-base)"
    line-height: 1.5
  sidebar:
    width: "264px"
    background: "var(--color-page)"
  button:
    background: "transparent"
    color: "var(--color-ink)"
    border: "none"
    border-radius: "var(--radius-sm)"
    padding: "4px 8px"
    font-size: "var(--font-size-200)"
    line-height: 1.2
  link:
    color: "var(--color-accent)"
    hover: "var(--color-ink)"
  input:
    background: "var(--color-page-muted)"
    border: "1px solid transparent"
    border-radius: "var(--radius-sm)"
---

# Arcane Codex Design System

## Overview

A dark, dense, content-first local workspace calibrated to the supplied Notion reference. The document, cover, and structured data carry the visual identity; application chrome stays quiet and contextual.

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
