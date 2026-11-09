# Plant Knowledge Graph – web deliverable (Vercel)

A static version of the prototype: the ISA-88 knowledge graph plus the analytics app built on top of it.
It needs no Docker, Neo4j or TimescaleDB, so it can be hosted on Vercel.

> All data is **simulated**. The equipment, recipes, batches and lots are assumptions. No company data is used.

## What's inside

| Page | What it shows |
|---|---|
| Overview | The golden story (B-0412 → TT-101 drift → TX-200 at TT-301) and the architecture |
| Knowledge graph | An interactive graph explorer with preset views, search, layer filters, a node inspector and neighbour expansion |
| Batch traceability | Lots in and out, downstream batches, phase runs (planned vs. actual), process-value charts and the batch subgraph |
| Fault analysis | Alarm history per Control Module, the device installed at each alarm, and per-batch peaks from the graph aggregates |
| Maintenance knowledge | Where a device model is installed, its work-order history and the drift recommendation |
| Data model | Graph schema, node and relationship counts, data-quality checks, and downloads (`graph.json`, `graph.cypher`) |

Every table and chart is a traversal of the in-browser graph (`src/kg.js`). The Cypher query that answers the same
question in Neo4j is shown next to it.

## How the data is made

`scripts/build_graph.py` replays the deterministic scenario (`../services/scenario.py`) for the 30 historical
batches **B-0391 to B-0420**. It applies the same graph rules as the sync job (`../services/sync.py`) in memory and writes:

- `public/data/graph.json`: 267 nodes and 880 relationships, with the same labels, types and properties as in Neo4j
- `public/data/pv/B-xxxx.json`: raw process values per batch, i.e. the time-series store. They are kept outside the graph (ADR-0001).
- `public/data/graph.cypher`: a script that loads the same graph into Neo4j 5 (`cypher-shell -f graph.cypher`)
- `public/data/meta.json`: build information

The generated files are committed, so Vercel only runs the Vite build. Re-generate them after changing the scenario:

```bash
python scripts/build_graph.py
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview
```

## Deploy to Vercel

- **Dashboard:** import the repository and set **Root Directory = `web`**. The framework (Vite), the build command and the
  `dist` output come from `vercel.json`.
- **CLI:** from this folder, `npx vercel` (preview) or `npx vercel --prod`.

Routing uses URL hashes (e.g. `/#/trace?batch=B-0412`), so links to any view can be shared and no rewrites are needed.
