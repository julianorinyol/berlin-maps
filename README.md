# Berlin No-Turn Bike Routes

**🔗 Live site: https://julianorinyol.github.io/berlin-maps/**

An interactive map of Berlin bike routes that stay "straight" — the street
changes name at every block, but you never turn — plus a couple of other
route collections (Nice Bike Rides, Wasserwanderwege).

Built with React, Leaflet and OpenStreetMap tiles.

## Development

```
npm install
npm run dev
```

Route data lives in `src/data/routes.json` and `src/data/wasserwege.json`.
When running the dev server, each route's detail page has an edit icon
(✏️) that opens an editor — including a "edit points on map" mode with
click-to-delete and shift-click range deletion — which saves straight back
to those JSON files via a small local-only dev API
(`vite.config.js`). None of that editing capability exists in the deployed
build.

## Deploying

```
npm run deploy
```

This builds the app and pushes `dist/` to the `gh-pages` branch (via the
`gh-pages` package). GitHub Pages then serves it from that branch — see
repo Settings → Pages if it needs to be pointed there for the first time.
