"""Build the static knowledge graph for the Vercel deliverable.

Replays the deterministic scenario (services/scenario.py) for the historical batches
B-0391..B-0420 and applies the same rules as services/sync.py, but in memory, so no
Docker / Neo4j / TimescaleDB is needed. Output (web/public/data/):

  graph.json          nodes + relationships, same labels / types / properties as Neo4j
  pv/B-xxxx.json      raw process values per batch (the "time-series store", ADR-0001)
  graph.cypher        CREATE script to load the same graph into a real Neo4j
  meta.json           build info and pipeline statistics

Run:  python web/scripts/build_graph.py
"""
import csv
import json
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "services"))
import scenario as sc  # noqa: E402

DATA_DIR = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "web", "public", "data")
ANCHOR = datetime(2026, 10, 1, tzinfo=timezone.utc)  # matches generated/state.json
LAST_BATCH = 420
LEVELS = ["Enterprise", "Site", "Area", "ProcessCell", "Unit", "EquipmentModule", "ControlModule"]


def iso(dt):
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fnum(s):
    return float(s) if s not in (None, "") else None


class Graph:
    def __init__(self):
        self.nodes = {}  # key -> {key, labels, props}
        self.rels = {}   # (type, start, end, discriminator) -> rel

    def node(self, label, ident, *extra_labels, **props):
        key = f"{label}:{ident}"
        n = self.nodes.get(key)
        if n is None:
            n = self.nodes[key] = {"key": key, "labels": [label], "props": {}}
        for lb in extra_labels:
            if lb not in n["labels"]:
                n["labels"].append(lb)
        n["props"].update({k: v for k, v in props.items()})
        return key

    def rel(self, start, rtype, end, disc="", **props):
        k = (rtype, start, end, disc)
        r = self.rels.get(k)
        if r is None:
            r = self.rels[k] = {"type": rtype, "start": start, "end": end, "props": {}}
        r["props"].update(props)
        return r

    def out(self, start, rtype):
        return [r for r in self.rels.values() if r["start"] == start and r["type"] == rtype]

    def inc(self, end, rtype):
        return [r for r in self.rels.values() if r["end"] == end and r["type"] == rtype]


def eq(ident):
    return f"Equipment:{ident}"


def main():
    recipes, tags = sc.init(DATA_DIR)
    g = Graph()

    # --- master data: Engineering Master List, tag list, recipes --------------
    hierarchy = read_csv(os.path.join(DATA_DIR, "engineering_master_list.csv"))
    for row in hierarchy:
        g.node("Equipment", row["id"], row["level"], id=row["id"], name=row["name"], level=row["level"])
    for row in hierarchy:
        if row["parent_id"]:
            g.rel(eq(row["parent_id"]), "CONTAINS", eq(row["id"]), validFrom=row["valid_from"])
    for row in tags.values():
        t = g.node("Tag", row["tag_id"], id=row["tag_id"], topic=row["topic"], engUnit=row["eng_unit"],
                   description=row["description"], datatype=row["datatype"],
                   limitLo=fnum(row["lo"]), limitHi=fnum(row["hi"]), limitHiHi=fnum(row["hihi"]),
                   timeSeriesStore="timescaledb:staging.process_value")
        g.rel(eq(row["cm_id"]), "HAS_TAG", t)

    for r in recipes.values():
        mr = g.node("MasterRecipe", r["id"], id=r["id"], name=r["name"], version=r["version"])
        pm = g.node("Material", r["productMaterial"], id=r["productMaterial"])
        g.rel(mr, "MAKES", pm)
        for up in r["unitProcedures"]:
            u = g.node("UnitProcedure", up["id"], id=up["id"], name=up["name"])
            g.rel(mr, "HAS_UNIT_PROCEDURE", u)
            g.rel(u, "RUNS_ON", eq(up["unit"]))
            for op in up["operations"]:
                o = g.node("Operation", op["id"], id=op["id"], name=op["name"])
                g.rel(u, "HAS_OPERATION", o)
                for ph in op["phases"]:
                    sp = {f"sp_{k}": v for k, v in ph["setpoints"].items()}
                    p = g.node("Phase", ph["id"], id=ph["id"], name=ph["name"], type=ph["type"],
                               startMin=ph["startMin"], durationMin=ph["durationMin"], **sp)
                    g.rel(o, "HAS_PHASE", p)
                    g.rel(p, "RUNS_ON", eq(ph["equipmentModule"]))

    # --- events: replay the scenario like edge_sim -> ingest -> sync ----------
    os.makedirs(os.path.join(OUT, "pv"), exist_ok=True)
    alarm_times, events, pv_count, ev_count = {}, [], 0, 0
    pv_store = {}  # tag -> list[(datetime, value)] (all batches; small)
    batch_starts = {}
    for n in range(sc.FIRST_BATCH, LAST_BATCH + 1):
        bid = sc.batch_id(n)
        start = sc.backfill_start(ANCHOR, n)
        batch_starts[bid] = start
        series = {}
        for m in sc.generate_batch(n, recipes):
            ts = start + timedelta(minutes=m.minute)
            ts = ts.replace(microsecond=(ts.microsecond // 1000) * 1000)  # epoch ms, like Litmus
            if m.kind == "pv":
                tag, v = m.body["tagId"], m.body["value"]
                pv_store.setdefault(tag, []).append((ts, v))
                series.setdefault(tag, []).append([round(m.minute, 2), v])
                pv_count += 1
            else:
                if m.body["eventType"] == "ALARM":
                    alarm_times[m.body["eventId"]] = ts
                events.append((ts, m.body))
                ev_count += 1
        with open(os.path.join(OUT, "pv", f"{bid}.json"), "w", encoding="utf-8") as f:
            json.dump({"batch": bid, "start": iso(start), "unit": "minutes since batch start",
                       "series": series}, f, separators=(",", ":"))

    def pv_between(tag_ids, t0, t1):
        out = {}
        for t in tag_ids:
            vals = [v for ts, v in pv_store.get(t, []) if t0 <= ts <= t1]
            if vals:
                out[t] = vals
        return out

    pr_start = {}
    for ts, e in events:  # ingest order = time order within a batch, batches sequential
        et = e["eventType"]
        if et == "BATCH_START":
            b = g.node("Batch", e["batchId"], id=e["batchId"])
            g.nodes[b]["props"].setdefault("status", "RUNNING")
            g.nodes[b]["props"]["start"] = iso(ts)
            g.rel(b, "FOLLOWS", f"MasterRecipe:{e['recipeId']}")
        elif et == "BATCH_END":
            g.node("Batch", e["batchId"], id=e["batchId"], end=iso(ts), status=e["status"])
        elif et == "PHASE_START":
            b = g.node("Batch", e["batchId"], id=e["batchId"])
            ph = g.nodes[f"Phase:{e['phaseId']}"]
            pr = g.node("PhaseRun", e["phaseRunId"], id=e["phaseRunId"], start=iso(ts), name=ph["props"]["name"])
            pr_start[pr] = ts
            g.rel(b, "HAS_PHASE_RUN", pr)
            g.rel(pr, "INSTANCE_OF", ph["key"])
            g.rel(pr, "EXECUTED_ON", eq(e["equipmentModule"]))
        elif et == "PHASE_END":
            pr = f"PhaseRun:{e['phaseRunId']}"
            actuals = {f"actual_{k}": v for k, v in e.get("actuals", {}).items()}
            g.node("PhaseRun", e["phaseRunId"], end=iso(ts), **actuals)
            em = g.out(pr, "EXECUTED_ON")[0]["end"]
            tag_keys = [t["end"] for cm in g.out(em, "CONTAINS") for t in g.out(cm["end"], "HAS_TAG")]
            ids = [g.nodes[k]["props"]["id"] for k in tag_keys]
            for tag, vals in pv_between(ids, pr_start[pr], ts).items():
                g.rel(pr, "MEASURED", f"Tag:{tag}", min=min(vals), max=max(vals),
                      avg=round(sum(vals) / len(vals), 3), samples=len(vals))
        elif et in ("MATERIAL_CONSUMED", "MATERIAL_PRODUCED"):
            b = g.node("Batch", e["batchId"], id=e["batchId"])
            lot = g.node("MaterialLot", e["lotId"], id=e["lotId"])
            mat = g.node("Material", e["materialId"], id=e["materialId"], name=e["materialName"])
            g.rel(lot, "OF_MATERIAL", mat)
            rtype = "CONSUMED" if et == "MATERIAL_CONSUMED" else "PRODUCED"
            g.rel(b, rtype, lot, qtyKg=e["qtyKg"], time=iso(ts))
        elif et == "ALARM":
            a = g.node("Alarm", e["eventId"], id=e["eventId"], time=iso(ts), level=e["level"],
                       severity=e["severity"], limit=e["limit"], value=e["value"], message=e["message"],
                       tagId=e["tagId"])
            g.rel(a, "RAISED_BY", eq(e["controlModule"]))

    # --- CMMS export (simulated SAP PM) ---------------------------------------
    devices, wos = sc.cmms_records(ANCHOR, alarm_times)
    check_cmms(devices, wos)
    for d in devices:
        dk = g.node("PhysicalDevice", d["serial"], serial=d["serial"], model=d["model"],
                    manufacturer=d["manufacturer"])
        g.rel(dk, "INSTALLED_AT", eq(d["cm_id"]), disc=d["installed_from"],
              **{"from": iso(datetime.fromisoformat(d["installed_from"])),
                 "to": iso(datetime.fromisoformat(d["installed_to"])) if d["installed_to"] else None})
    for w in wos:
        wk = g.node("WorkOrder", w["wo_id"], id=w["wo_id"], created=iso(datetime.fromisoformat(w["created"])),
                    completed=iso(datetime.fromisoformat(w["completed"])), failureCode=w["failure_code"],
                    description=w["description"], alarmRef=w["alarm_ref"])
        g.rel(wk, "ON", eq(w["cm_id"]))
        if w["removed_serial"]:
            g.rel(wk, "REMOVED", f"PhysicalDevice:{w['removed_serial']}")
        if w["installed_serial"]:
            g.rel(wk, "INSTALLED", f"PhysicalDevice:{w['installed_serial']}")

    # --- context enrichment (LINK_ALARMS / LINK_WORK_ORDERS in sync.py) --------
    def parent(key):
        r = g.inc(key, "CONTAINS")
        return r[0]["start"] if r else None

    for a in [k for k, n in g.nodes.items() if "Alarm" in n["labels"]]:
        at = datetime.fromisoformat(g.nodes[a]["props"]["time"].replace("Z", "+00:00"))
        cm = g.out(a, "RAISED_BY")[0]["end"]
        own = parent(cm)
        unit = parent(own)
        cands = []
        for emr in g.out(unit, "CONTAINS"):
            em = emr["end"]
            for prr in g.inc(em, "EXECUTED_ON"):
                p = g.nodes[prr["start"]]["props"]
                s = datetime.fromisoformat(p["start"].replace("Z", "+00:00"))
                e = datetime.fromisoformat(p["end"].replace("Z", "+00:00")) if p.get("end") else None
                if s <= at and (e is None or at <= e):
                    cands.append((0 if em == own else 1, -s.timestamp(), prr["start"]))
        if cands:
            g.rel(a, "DURING", sorted(cands)[0][2])
    for w in [k for k, n in g.nodes.items() if "WorkOrder" in n["labels"]]:
        ref = g.nodes[w]["props"]["alarmRef"]
        if ref and f"Alarm:{ref}" in g.nodes:
            g.rel(w, "TRIGGERED_BY", f"Alarm:{ref}")

    # --- write ------------------------------------------------------------------
    nodes = list(g.nodes.values())
    rels = [{"id": i, **r} for i, r in enumerate(g.rels.values())]
    with open(os.path.join(OUT, "graph.json"), "w", encoding="utf-8") as f:
        json.dump({"nodes": nodes, "relationships": rels}, f, separators=(",", ":"))
    write_cypher(nodes, rels)

    topics_ok = all(t["cm_id"] in {h["id"] for h in hierarchy} for t in tags.values())
    meta = {
        "built": iso(datetime.now(timezone.utc)),
        "anchor": iso(ANCHOR),
        "batches": [sc.batch_id(n) for n in range(sc.FIRST_BATCH, LAST_BATCH + 1)],
        "processValues": pv_count,
        "events": ev_count,
        "tagsInMasterList": len(tags),
        "allTopicsInMasterList": topics_ok,
        "unknownTopics": [],
    }
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"graph: {len(nodes)} nodes, {len(rels)} relationships; "
          f"{pv_count} process values, {ev_count} events -> {OUT}")


def check_cmms(devices, wos):
    """The CMMS export must match the one the Docker stack wrote (same anchor)."""
    gen = os.path.join(ROOT, "generated", "cmms_work_orders.csv")
    if os.path.exists(gen):
        on_disk = read_csv(gen)
        if [r["created"] for r in on_disk] != [w["created"] for w in wos]:
            print("WARNING: CMMS export differs from generated/cmms_work_orders.csv", file=sys.stderr)


def cypher_value(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v)
    if len(s) >= 20 and s[4] == "-" and s[10] == "T" and s.endswith("Z"):
        return f"datetime('{s}')"
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def cypher_props(p):
    items = [f"`{k}`: {cypher_value(v)}" for k, v in p.items() if v is not None]
    return "{" + ", ".join(items) + "}"


def write_cypher(nodes, rels):
    idx = {n["key"]: i for i, n in enumerate(nodes)}
    lines = ["// ISA-88 Plant Knowledge Graph (simulated data), batches B-0391..B-0420.",
             "// Load into an empty Neo4j 5 database, e.g. cypher-shell -f graph.cypher",
             "CREATE INDEX import_key IF NOT EXISTS FOR (n:_Import) ON (n._k);"]
    for n in nodes:
        labels = ":".join(n["labels"] + ["_Import"])
        props = dict(n["props"], _k=idx[n["key"]])
        lines.append(f"CREATE (:{labels} {cypher_props(props)});")
    for r in rels:
        lines.append(f"MATCH (a:_Import {{_k: {idx[r['start']]}}}), (b:_Import {{_k: {idx[r['end']]}}}) "
                     f"CREATE (a)-[:{r['type']} {cypher_props(r['props'])}]->(b);")
    lines.append("MATCH (n:_Import) REMOVE n:_Import, n._k;")
    lines.append("DROP INDEX import_key IF EXISTS;")
    with open(os.path.join(OUT, "graph.cypher"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
