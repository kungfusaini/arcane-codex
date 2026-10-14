# Arcane Codex

A Hugo-powered personal blog.

## Setup

```bash
# Install dependencies
hugo mod get

# Run development server
hugo server -D

# Build for production
hugo
```

## Configuration

- **Theme**: PaperMod
- **Default Theme**: Dark mode
- **Base URL**: https://arcanecodex.dev/

## Content

Blog posts are stored in `content/posts/`. Create new posts with:

```bash
hugo new posts/post-title.md
```

## Theme Customization

Custom styles are in `assets/css/extended/custom-overrides.css`.

### Header Width
- Removed max-width constraint from header navigation
- Header now stretches to full screen width
- Elements align to edges instead of staying centered
- Original constraint was `max-width: calc(var(--nav-width) + var(--gap) * 2)`

## Fonts 

### Currently Active:
- **ProFontIIxNerdFontMono**: Body text
- **Eagle Lake**: Headings

### Previously Considered :
- **CormorantUnicase**
- **Jacquard 12**
- **Jacquard 24**
