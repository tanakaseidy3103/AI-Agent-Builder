---
name: react-accessibility-analyzer
description: "Finds common accessibility (a11y) problems in React/JSX and HTML: images without alt, clickable div/span without role or keyboard handler, anchors without href, unlabeled inputs. Use when reviewing frontend accessibility."
---

# React Accessibility Analyzer

Use when the user asks for an accessibility review of a React, Next.js or HTML frontend.

1. From this Skill's directory run:

```bash
python scripts/cli.py --dir <path-to-frontend>
```

2. Output JSON: `findings` (file, line, rule, element, fix), `count`, `files_scanned`.
3. Present findings by file with the suggested `fix`. Prioritize `img-alt` and `click-without-keyboard`
   (they block screen-reader and keyboard users).
4. This is a pattern-based scan of `.jsx/.tsx/.js/.html` files, not a full DOM audit: mention that dynamic props
   (e.g. `{...props}` spreading an `alt`) can cause false positives, and recommend axe/Lighthouse for runtime checks.

Rules: `img-alt`, `click-without-keyboard`, `anchor-href`, `input-label`.
