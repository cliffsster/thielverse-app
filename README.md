# The Thielverse

An interactive, shareable version of the Obsidian graph view for the `thielverse/` vault.
Click a node to read its note; wikilinks inside notes move around the graph; every note has
a shareable URL (`/#/Peter%20Thiel`).

## How it works

- `thielverse/` is the Obsidian vault, committed as-is. Edit notes in Obsidian.
- `scripts/build-data.mjs` reads the vault at build time and writes `public/vault.json`:
  every note pre-rendered to HTML (wikilinks, callouts, tables), the link graph, backlinks,
  and the colour groups from `thielverse/.obsidian/graph.json`.
- `src/main.js` renders the graph with [force-graph](https://github.com/vasturiano/force-graph)
  and the note panel. No server: the whole site is static.

## Develop

```sh
npm install
npm run dev      # rebuilds vault.json, then starts Vite
npm run build    # production build into dist/
```

## Deploy (Vercel)

Import the GitHub repo in Vercel. `vercel.json` sets the build (`npm run build`) and output
(`dist`), so no settings are needed. Every push redeploys with the current vault.

## What is not committed

`thielverse/.obsidian/` is ignored except `graph.json`. The rest is per-device app state,
and the Local REST API plugin's folder holds an API key and certificates.
