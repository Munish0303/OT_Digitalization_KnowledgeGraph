# ISA-88 Plant Knowledge Graph (prototype)

This prototype was built for an interview concept. It is a **Neo4j knowledge graph** that follows the **ISA-88** physical and procedural models and is fed from the automation layer by an edge data orchestrator. **Litmus Edge** is simulated here.

> All data is **simulated**. The equipment, recipes, batches and lots are assumptions. No company data is used.

## Architecture

```
 Level 0-2          Level 3                 Level 3.5 (DMZ)                  Level 4 (IT)
 PLC / batch  ──▶  litmus-edge-sim  ──MQTT──▶ mqtt-broker ──▶ ingest ──▶ TimescaleDB ──▶ kg-sync ──▶ Neo4j
 (simulated)       Litmus payloads          (UNS topics)              (staging + time series)        │
                                                                         ▲                           ▼
                                                    CMMS export (CSV) ───┼─────────────────────▶  Streamlit app
```

- **Unified Namespace.** Topic paths mirror ISA-88, e.g. `givaudan/dortmund/production/pc01/r101/r101-temp/tt101/pv`.
- **Raw process values stay in TimescaleDB.** The graph only holds structure, events, aggregates and a reference from each Tag to its time series ([ADR-0001](docs/adr/0001-no-raw-time-series-in-neo4j.md)).
- **The Engineering Master List owns the plant hierarchy.** If a topic arrives that isn't in the list, it is flagged for review and not added to the graph automatically ([ADR-0002](docs/adr/0002-master-list-owns-hierarchy.md)).
- **Data flows one way, from OT to IT, and nothing writes back.** The Compose networks mirror the Purdue zones ([ADR-0003](docs/adr/0003-one-way-ot-to-it-no-write-back.md)).
- **Glossary:** [CONTEXT.md](CONTEXT.md).

## Project layout

| Path | What |
|---|---|
| `services/` | Python services (edge simulator, ingest, sync, Streamlit app) and their Dockerfile |
| `data/` | Seed data: Engineering Master List, tag list, Litmus topics/tags, master recipes |
| `docs/adr/` | Architecture decision records |
| `queries/` | Cypher queries for the golden story |
| `web/` | Static React + Vite version of the graph and app (deploys to Vercel) |
| `deck/` | Concept deck generator (pptxgenjs) |

## Requirements

- Docker with Docker Compose (for the full stack)
- Node 18+ (for `web/` and `deck/`), Python 3.12 (to regenerate web data)

## Run

```bash
docker compose up -d --build
```

| What | URL |
|---|---|
| Demo app | http://localhost:8501 |
| Neo4j Browser | http://localhost:7474 (`neo4j` / `knowledge-graph`) |

On first start, the simulator publishes **30 historical batches**. After about a minute the sync job has built the graph. By default nothing more is added. To also run new batches **live at 60× speed**, start with `LIVE=1` (PowerShell: `$env:LIVE="1"; docker compose up -d`).

To start over:

```bash
docker compose down -v && rm -rf generated
```

## Web deliverable (Vercel)

[`web/`](web/README.md) has a static build of the knowledge graph and the analytics app for batches B-0391 to B-0420. It runs without Docker and deploys to Vercel with Root Directory `web`.

## Real Litmus Edge mode (optional)

With `LITMUS=1`, the real Litmus Edge (Developer Edition, Docker) takes over the tag data path:

```
scenario ──▶ litmus-edge-sim (OPC UA server = simulated PLC, :4840)
                  │  OPC UA (DeviceHub)
             Litmus Edge ──MQTT (Integration "MQTT - Generic", topic litmus/...)──▶ mqtt-broker ──▶ ingest ...
```

Batch, phase, alarm and material events still come from `litmus-edge-sim` (batch system / MES). The 30 backfill batches always come over MQTT, because Litmus only reads current values.

```powershell
docker load -i litmusedge-std-docker_4.4.1-amd64.docker.tar.gz
docker run -d --name litmusedge --restart unless-stopped --cap-add=net_admin -p 8443:443 litmusedge-std-docker:4.4.1
docker network connect isa88-kg_ot_l3 litmusedge     # reads the PLC
docker network connect isa88-kg_dmz_l35 litmusedge   # publishes to the broker
$env:LITMUS="1"; docker compose up -d
```

In the Litmus UI (https://localhost:8443, first login `admin` / `litmusedge`):
- **DeviceHub:** OPC UA device, endpoint `opc.tcp://litmus-edge-sim:4840/`, security None, anonymous. Tags by node id `ns=2;s=<tag_id>`, e.g. `ns=2;s=TT101.PV`, name `TT101_PV`, poll 1 s.
- **Integration:** "MQTT - Generic", host `mqtt-broker`, port `1883`, no TLS or login. Outbound topic (Local to Remote) with a remote topic under `litmus/`, e.g. `litmus/dortmund/pc01`.

Ingest matches Litmus messages by `tagName`, so the topic name under `litmus/` does not matter. Unknown tag names show up for review like unknown topics. The Developer Edition runs in 2-hour sessions; when it stops, tag values stop and events continue.

## Golden story

The demo follows one storyline. The queries for it are in [`queries/golden_story.cypher`](queries/golden_story.cypher).

1. **Traceability.** Batch **B-0412** (Citrus Base) raises a HIHI alarm on TT-101 during *Hold*. The graph answers which raw-material lots went in, and which product lots and downstream batches (B-0413, B-0414) are affected.
2. **Fault analysis.** TT-101 had already raised warnings in B-0400 and B-0406. Work order WO-76890 at that time found "no fault". The per-batch peaks show the drift building up.
3. **Maintenance knowledge.** WO-77012 replaced the transmitter, which was model TX-200. The same model is still installed at **TT-301**, which drifted before, so a check there is recommended.

## Services

| Service | Zone | Role |
|---|---|---|
| `litmus-edge-sim` | L3 | Scenario engine. Publishes tags in the Litmus Edge payload format plus batch, phase, alarm and material events |
| `mqtt-broker` | L3.5 | Mosquitto |
| `ingest` | L3.5 | Writes MQTT messages to TimescaleDB (idempotent) and records unknown topics |
| `timescaledb` | L3.5 | Staging area and time-series store |
| `kg-sync` | L4 | Incremental, watermark-based sync into Neo4j using `MERGE`. Links alarms to Phase Runs |
| `neo4j` | L4 | Knowledge graph |
| `app` | L4 | Read-only Streamlit front end |

## Deck

```bash
cd deck && npm install
python screenshots.py      # needs the stack running; captures app screenshots into deck/img/ (pip install playwright, uses local Chrome)
node build.js              # writes ISA88_Knowledge_Graph_Concept.pptx
powershell -File render.ps1  # optional: renders every slide to deck/render/*.png for visual QA
```
