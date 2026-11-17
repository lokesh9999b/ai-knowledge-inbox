# Diagrams

The diagrams in the README and docs are generated from the Mermaid sources in this folder.

| Source | Shown in |
|---|---|
| `architecture.mmd` | README, system design |
| `saving-flow.mmd`, `asking-flow.mmd` | design notes, code walkthrough |
| `llm-chain.mmd` | README, design notes |
| `ingest-sequence.mmd`, `query-sequence.mmd` | system design |

Each diagram is rendered twice, `name.png` (light) and `name-dark.png` (dark), and the docs embed both with a
`<picture>` tag, so GitHub shows the one that matches the reader's theme.

The committed PNGs in `../images/diagrams/` are what the docs embed, so they display in any Markdown viewer (many
editors and previews do not draw Mermaid, and wide Mermaid diagrams shrink to unreadable on narrow pages).

To change a diagram, edit its `.mmd` file and regenerate the images (needs Chrome or Edge and internet access to load
Mermaid from a CDN; set `CHROME=<path>` if the browser is not found):

```bash
node scripts/render-diagrams.mjs              # all diagrams
node scripts/render-diagrams.mjs llm-chain    # just one
```

## App screenshots

`../images/app*.png` are captured from the running app with headless Chrome. The app has a single (light) design, so the
`*-dark.png` versions are Chrome's automatic dark rendering of the same UI, not a separate theme.
