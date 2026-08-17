---
colors:
  neutral: "#f4efe2"
  neutral-ink: "#1f1d19"
  neutral-muted: "#6a6456"
  neutral-border: "#d6d0c1"
  accent: "#446655"
  accent-on: "#f4efe2"
  shadow: "rgba(26, 24, 20, 0.24)"
  success: "#2e7d5a"
  warning: "#8a5a23"
  danger: "#7f2f1d"
  card: "#f8f2e3"
  page: "#efe7d6"
  page-muted: "#e8dfce"

typography:
  family:
    base: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
  scale:
    100: "12px"
    200: "14px"
    300: "16px"
    400: "18px"
    500: "20px"
    600: "24px"
    700: "30px"
    800: "36px"

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
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px

elevation:
  sm: "0 1px 2px var(--shadow), 0 1px 2px var(--shadow)"
  md: "0 6px 12px var(--shadow)"
  lg: "0 12px 24px var(--shadow)"
  xl: "0 18px 36px var(--shadow)"

components:
  body:
    background: "var(--color-neutral)"
    color: "var(--color-ink)"
    font-family: "var(--font-base)"
    line-height: 1.55
  card:
    background: "var(--color-card)"
    border: "1px solid var(--color-border)"
    border-radius: "var(--radius-md)"
    box-shadow: "var(--elevation-sm)"
  sidebar:
    width: "280px"
    background: "var(--color-page)"
  button:
    background: "transparent"
    color: "var(--color-ink)"
    border: "1px solid var(--color-border)"
    border-radius: "var(--radius-sm)"
    padding: "6px 12px"
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
8px-based rhythm with a modular scale from body text to heading sizes. Keep line lengths comfortable for long-form reading.

## Layout
A dominant content work surface with a quiet sidebar for navigation and state.

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
