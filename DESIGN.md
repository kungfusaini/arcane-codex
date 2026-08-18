---
colors:
  neutral: "#f6f1e7"
  neutral-ink: "#24211c"
  neutral-muted: "#625d52"
  neutral-border: "#d8d0c1"
  accent: "#315d4a"
  accent-on: "#fffaf0"
  shadow: "rgba(36, 33, 28, 0.16)"
  success: "#24543d"
  warning: "#8a5a23"
  danger: "#843b2c"
  danger-muted: "#f1dfd8"
  card: "#fffaf0"
  page: "#eee8dc"
  page-muted: "#e5ded1"

typography:
  family:
    base: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    display: "Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
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
  7: 28px
  8: 32px
  10: 40px
  12: 48px

rounded:
  sm: 6px
  md: 10px
  lg: 16px
  xl: 24px

elevation:
  sm: "0 1px 2px var(--shadow)"
  md: "0 8px 24px var(--shadow)"
  lg: "0 16px 40px var(--shadow)"
  xl: "0 24px 64px var(--shadow)"

components:
  body:
    background: "var(--color-neutral)"
    color: "var(--color-ink)"
    font-family: "var(--font-base)"
    line-height: 1.55
  card:
    background: "var(--color-card)"
    border-radius: "var(--radius-md)"
    box-shadow: "none"
  sidebar:
    width: "256px"
    background: "var(--color-page)"
  button:
    background: "transparent"
    color: "var(--color-ink)"
    border: "none"
    border-radius: "var(--radius-sm)"
    padding: "8px 12px"
    font-size: "var(--font-size-300)"
    line-height: 1.2

  link:
    color: "var(--color-accent)"
    hover: "var(--color-ink)"

  input:
    background: "var(--color-page)"
    border: "1px solid var(--color-border)"
    border-radius: "var(--radius-sm)"
---

# Arcane Codex Design System

## Overview
An editorial workspace with warm paper surfaces, charcoal reading content, and restrained moss accents.

## Colors
- **neutral**: paper-like base.
- **neutral-ink**: high-contrast typographic color.
- **neutral-muted**: secondary text.
- **accent**: single interaction accent.
- **card/page/page-muted**: canvas and surface layers.

## Typography
A restrained system sans handles navigation and controls. A local editorial serif stack gives page and collection titles a bookish voice without network fonts. The 8px-based rhythm and 768px reading measure keep long-form content calm.

## Layout
A quiet 256px desktop rail yields to the document. At narrow widths it becomes an off-canvas drawer behind a compact sticky top bar, so content always appears first. Page content uses a 768px reading measure; collections expand to a broad table surface.

## Elevation
Use only named elevation levels `sm`, `md`, `lg`, `xl`.

## Shapes
Rounded corners are tokenized by size; avoid hard-coded radius values.

## Components
Focus states and disabled states are required for all interactive controls. Empty/loading/error states always include recovery actions.

## Do's & Don'ts
- Do not use gradients, glows, glass effects, decorative borders.
- Do not introduce additional color accents.
- Do not use non-token spacing or shadows outside the elevation palette.
- Do disclose administration through contextual menus and settings regions.
- Do not frame the editor, page, or collection work surface as a nested card.
