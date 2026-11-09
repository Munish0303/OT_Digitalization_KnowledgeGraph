"""Knowledge-graph sync (Purdue level 4, IT): TimescaleDB staging + master data -> Neo4j.

Every cycle:
  1. master data (Engineering Master List, tag list, Master Recipes, CMMS export),
     reloaded when a file changes;
  2. new staging events since the watermark (batches, phase runs, material lots, alarms);
  3. context enrichment: Alarm -[:DURING]-> PhaseRun, WorkOrder -[:TRIGGERED_BY]-> Alarm.
All writes use MERGE, so a cycle can be re-run safely (idempotent).
"""
import csv
import json
import os
import time
from datetime import datetime, timezone

import psycopg
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable

PG_DSN = os.getenv("PG_DSN", "postgresql://postgres:postgres@localhost:5432/plantdata")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_AUTH = tuple(os.getenv("NEO4J_AUTH", "neo4j/knowledge-graph").split("/", 1))
DATA_DIR = os.getenv("DATA_DIR", "/data")
GEN_DIR = os.getenv("GEN_DIR", "/generated")
INTERVAL = int(os.getenv("SYNC_INTERVAL", "10"))
CHUNK = 500

LEVELS = ["Enterprise", "Site", "Area", "ProcessCell", "Unit", "EquipmentModule", "ControlModule"]


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), "[kg-sync]", *a, flush=True)


def parse_dt(s: str):
    return datetime.fromisoformat(s) if s else None


def read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


# --- schema ----------------------------------------------------------------

CONSTRAINTS = [
    ("Equipment", "id"), ("Tag", "id"), ("PhysicalDevice", "serial"),
    ("MasterRecipe", "id"), ("UnitProcedure", "id"), ("Operation", "id"), ("Phase", "id"),
    ("Batch", "id"), ("PhaseRun", "id"), ("MaterialLot", "id"), ("Material", "id"),
    ("Alarm", "id"), ("WorkOrder", "id"),
]


def ensure_schema(session):
    for label, prop in CONSTRAINTS:
        session.run(f"CREATE CONSTRAINT {label.lower()}_{prop} IF NOT EXISTS "
                    f"FOR (n:{label}) REQUIRE n.{prop} IS UNIQUE")
    session.run("CREATE INDEX phaserun_start IF NOT EXISTS FOR (p:PhaseRun) ON (p.start)")
    session.run("CREATE INDEX alarm_time IF NOT EXISTS FOR (a:Alarm) ON (a.time)")


# --- master data -----------------------------------------------------------

def load_hierarchy(session):
    rows = read_csv(f"{DATA_DIR}/engineering_master_list.csv")
    for level in LEVELS:  # label comes from a whitelist, never from input
        batch = [r for r in rows if r["level"] == level]
        session.run(f"""
            UNWIND $rows AS row
            MERGE (e:Equipment {{id: row.id}})
            SET e:{level}, e.name = row.name, e.level = row.level
            """, rows=batch)
    session.run("""
        UNWIND $rows AS row
        MATCH (c:Equipment {id: row.id}), (p:Equipment {id: row.parent_id})
        MERGE (p)-[r:CONTAINS]->(c)
        SET r.validFrom = date(row.valid_from)
        """, rows=[r for r in rows if r["parent_id"]])
    session.run("""
        UNWIND $rows AS row
        MATCH (cm:ControlModule {id: row.cm_id})
        MERGE (t:Tag {id: row.tag_id})
        SET t.topic = row.topic, t.engUnit = row.eng_unit, t.description = row.description,
            t.datatype = row.datatype,
            t.limitLo = toFloat(row.lo), t.limitHi = toFloat(row.hi), t.limitHiHi = toFloat(row.hihi),
            t.timeSeriesStore = 'timescaledb:staging.process_value'
        MERGE (cm)-[:HAS_TAG]->(t)
        """, rows=read_csv(f"{DATA_DIR}/tag_list.csv"))
    log(f"hierarchy loaded: {len(rows)} equipment nodes")


def load_recipes(session):
    with open(f"{DATA_DIR}/master_recipes.json", encoding="utf-8") as f:
        recipes = json.load(f)
    for r in recipes:
        session.run("""
            MERGE (mr:MasterRecipe {id: $r.id})
            SET mr.name = $r.name, mr.version = $r.version
            MERGE (pm:Material {id: $r.productMaterial})
            MERGE (mr)-[:MAKES]->(pm)
            WITH mr
            UNWIND $r.unitProcedures AS up
            MERGE (u:UnitProcedure {id: up.id}) SET u.name = up.name
            MERGE (mr)-[:HAS_UNIT_PROCEDURE]->(u)
            WITH u, up
            MATCH (unit:Unit {id: up.unit})
            MERGE (u)-[:RUNS_ON]->(unit)
            WITH u, up
            UNWIND up.operations AS op
            MERGE (o:Operation {id: op.id}) SET o.name = op.name
            MERGE (u)-[:HAS_OPERATION]->(o)
            WITH o, op
            UNWIND op.phases AS ph
            MERGE (p:Phase {id: ph.id})
            SET p.name = ph.name, p.type = ph.type, p.startMin = ph.startMin, p.durationMin = ph.durationMin
            MERGE (o)-[:HAS_PHASE]->(p)
            WITH p, ph
            MATCH (em:EquipmentModule {id: ph.equipmentModule})
            MERGE (p)-[:RUNS_ON]->(em)
            """, r=r)
        # Setpoints as properties sp_<name> (recipe IP: hidden from non-production roles via RBAC).
        for up in r["unitProcedures"]:
            for op in up["operations"]:
                for ph in op["phases"]:
                    sp = {f"sp_{k}": v for k, v in ph["setpoints"].items()}
                    session.run("MATCH (p:Phase {id: $id}) SET p += $sp", id=ph["id"], sp=sp)
    log(f"master recipes loaded: {len(recipes)}")


def load_cmms(session):
    dev_path = f"{GEN_DIR}/cmms_device_installations.csv"
    wo_path = f"{GEN_DIR}/cmms_work_orders.csv"
    if not (os.path.exists(dev_path) and os.path.exists(wo_path)):
        return False
    devices = read_csv(dev_path)
    for d in devices:
        d["installed_from"] = parse_dt(d["installed_from"])
        d["installed_to"] = parse_dt(d["installed_to"])
    session.run("""
        UNWIND $rows AS row
        MERGE (d:PhysicalDevice {serial: row.serial})
        SET d.model = row.model, d.manufacturer = row.manufacturer
        WITH d, row
        MATCH (cm:ControlModule {id: row.cm_id})
        MERGE (d)-[r:INSTALLED_AT {from: row.installed_from}]->(cm)
        SET r.to = row.installed_to
        """, rows=devices)
    wos = read_csv(wo_path)
    for w in wos:
        w["created"] = parse_dt(w["created"])
        w["completed"] = parse_dt(w["completed"])
    session.run("""
        UNWIND $rows AS row
        MERGE (w:WorkOrder {id: row.wo_id})
        SET w.created = row.created, w.completed = row.completed, w.failureCode = row.failure_code,
            w.description = row.description, w.alarmRef = row.alarm_ref
        WITH w, row
        MATCH (cm:ControlModule {id: row.cm_id})
        MERGE (w)-[:ON]->(cm)
        WITH w, row
        OPTIONAL MATCH (rd:PhysicalDevice {serial: row.removed_serial})
        OPTIONAL MATCH (nd:PhysicalDevice {serial: row.installed_serial})
        FOREACH (_ IN CASE WHEN rd IS NULL THEN [] ELSE [1] END | MERGE (w)-[:REMOVED]->(rd))
        FOREACH (_ IN CASE WHEN nd IS NULL THEN [] ELSE [1] END | MERGE (w)-[:INSTALLED]->(nd))
        """, rows=wos)
    log(f"CMMS export loaded: {len(devices)} devices, {len(wos)} work orders")
    return True


# --- events ----------------------------------------------------------------

def on_batch_start(tx, e, ts, pg):
    tx.run("""
        MERGE (b:Batch {id: $e.batchId})
        SET b.start = $ts, b.status = coalesce(b.status, 'RUNNING')
        WITH b
        MATCH (mr:MasterRecipe {id: $e.recipeId})
        MERGE (b)-[:FOLLOWS]->(mr)
        """, e=e, ts=ts)


def on_batch_end(tx, e, ts, pg):
    tx.run("MERGE (b:Batch {id: $e.batchId}) SET b.end = $ts, b.status = $e.status", e=e, ts=ts)


def on_phase_start(tx, e, ts, pg):
    tx.run("""
        MERGE (b:Batch {id: $e.batchId})
        MERGE (pr:PhaseRun {id: $e.phaseRunId})
        SET pr.start = $ts
        MERGE (b)-[:HAS_PHASE_RUN]->(pr)
        WITH pr
        MATCH (ph:Phase {id: $e.phaseId}), (em:EquipmentModule {id: $e.equipmentModule})
        SET pr.name = ph.name
        MERGE (pr)-[:INSTANCE_OF]->(ph)
        MERGE (pr)-[:EXECUTED_ON]->(em)
        """, e=e, ts=ts)


def on_phase_end(tx, e, ts, pg):
    actuals = {f"actual_{k}": v for k, v in e.get("actuals", {}).items()}
    rec = tx.run("""
        MATCH (pr:PhaseRun {id: $e.phaseRunId})
        SET pr.end = $ts, pr += $actuals
        WITH pr
        MATCH (pr)-[:EXECUTED_ON]->(:EquipmentModule)-[:CONTAINS]->(:ControlModule)-[:HAS_TAG]->(t:Tag)
        RETURN pr.start AS start, collect(t.id) AS tags
        """, e=e, ts=ts, actuals=actuals).single()
    if not rec or not rec["tags"]:
        return
    # Aggregates from the time-series store become context on the graph (raw values stay in SQL).
    with pg.cursor() as cur:
        cur.execute("""
            SELECT tag_id, min(value), max(value), avg(value), count(*)
            FROM staging.process_value
            WHERE tag_id = ANY(%s) AND time BETWEEN %s AND %s
            GROUP BY tag_id""", (rec["tags"], rec["start"].to_native(), ts))
        aggs = [{"tag": t, "min": mn, "max": mx, "avg": round(av, 3), "n": c} for t, mn, mx, av, c in cur]
    tx.run("""
        MATCH (pr:PhaseRun {id: $id})
        UNWIND $aggs AS a
        MATCH (t:Tag {id: a.tag})
        MERGE (pr)-[m:MEASURED]->(t)
        SET m.min = a.min, m.max = a.max, m.avg = a.avg, m.samples = a.n
        """, id=e["phaseRunId"], aggs=aggs)


def on_material(tx, e, ts, pg):
    rel = "CONSUMED" if e["eventType"] == "MATERIAL_CONSUMED" else "PRODUCED"
    tx.run(f"""
        MERGE (b:Batch {{id: $e.batchId}})
        MERGE (l:MaterialLot {{id: $e.lotId}})
        MERGE (m:Material {{id: $e.materialId}})
        SET m.name = $e.materialName
        MERGE (l)-[:OF_MATERIAL]->(m)
        MERGE (b)-[r:{rel}]->(l)
        SET r.qtyKg = $e.qtyKg, r.time = $ts
        """, e=e, ts=ts)


def on_alarm(tx, e, ts, pg):
    tx.run("""
        MERGE (a:Alarm {id: $e.eventId})
        SET a.time = $ts, a.level = $e.level, a.severity = $e.severity, a.limit = $e.limit,
            a.value = $e.value, a.message = $e.message, a.tagId = $e.tagId
        WITH a
        MATCH (cm:ControlModule {id: $e.controlModule})
        MERGE (a)-[:RAISED_BY]->(cm)
        """, e=e, ts=ts)


HANDLERS = {
    "BATCH_START": on_batch_start, "BATCH_END": on_batch_end,
    "PHASE_START": on_phase_start, "PHASE_END": on_phase_end,
    "MATERIAL_CONSUMED": on_material, "MATERIAL_PRODUCED": on_material,
    "ALARM": on_alarm,
}

# Prefer the Phase Run on the alarm's own Equipment Module, else any run active on the same Unit.
LINK_ALARMS = """
MATCH (a:Alarm)-[:RAISED_BY]->(cm:ControlModule)<-[:CONTAINS]-(own:EquipmentModule)<-[:CONTAINS]-(u:Unit)
WHERE NOT (a)-[:DURING]->(:PhaseRun)
MATCH (u)-[:CONTAINS]->(em:EquipmentModule)<-[:EXECUTED_ON]-(pr:PhaseRun)
WHERE pr.start <= a.time AND (pr.end IS NULL OR a.time <= pr.end)
WITH a, pr, CASE WHEN em = own THEN 0 ELSE 1 END AS pref
ORDER BY pref, pr.start DESC
WITH a, head(collect(pr)) AS pr
MERGE (a)-[:DURING]->(pr)
RETURN count(*) AS linked
"""

LINK_WORK_ORDERS = """
MATCH (w:WorkOrder) WHERE w.alarmRef <> '' AND NOT (w)-[:TRIGGERED_BY]->()
MATCH (a:Alarm {id: w.alarmRef})
MERGE (w)-[:TRIGGERED_BY]->(a)
RETURN count(*) AS linked
"""


def get_watermark(pg) -> int:
    with pg.cursor() as cur:
        cur.execute("SELECT last_id FROM ops.sync_watermark WHERE source = 'event'")
        row = cur.fetchone()
        return row[0] if row else 0


def set_watermark(pg, last_id: int):
    with pg.cursor() as cur:
        cur.execute("""
            INSERT INTO ops.sync_watermark (source, last_id, last_run) VALUES ('event', %s, now())
            ON CONFLICT (source) DO UPDATE SET last_id = EXCLUDED.last_id, last_run = now()""", (last_id,))
    pg.commit()


def sync_events(driver, pg) -> int:
    total = 0
    while True:
        wm = get_watermark(pg)
        with pg.cursor() as cur:
            cur.execute("SELECT id, time, event_type, payload FROM staging.event WHERE id > %s ORDER BY id LIMIT %s",
                        (wm, CHUNK))
            rows = cur.fetchall()
        pg.commit()
        if not rows:
            return total
        with driver.session() as s:
            for _id, ts, etype, payload in rows:
                handler = HANDLERS.get(etype)
                if handler:
                    s.execute_write(lambda tx: handler(tx, payload, ts, pg))
        pg.commit()
        set_watermark(pg, rows[-1][0])
        total += len(rows)


def main():
    while True:
        try:
            driver = GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)
            driver.verify_connectivity()
            break
        except (ServiceUnavailable, OSError) as e:
            log("neo4j not ready:", e)
            time.sleep(3)
    while True:
        try:
            pg = psycopg.connect(PG_DSN)
            break
        except psycopg.OperationalError as e:
            log("database not ready:", str(e).splitlines()[0])
            time.sleep(2)
    log("connected to Neo4j and TimescaleDB")

    with driver.session() as s:
        ensure_schema(s)
        load_hierarchy(s)
        load_recipes(s)

    cmms_mtime = None
    while True:
        started = time.time()
        try:
            n = sync_events(driver, pg)
            with driver.session() as s:
                path = f"{GEN_DIR}/cmms_work_orders.csv"
                mtime = os.path.getmtime(path) if os.path.exists(path) else None
                if mtime and mtime != cmms_mtime and load_cmms(s):
                    cmms_mtime = mtime
                linked_a = s.run(LINK_ALARMS).single()["linked"]
                linked_w = s.run(LINK_WORK_ORDERS).single()["linked"]
            if n or linked_a or linked_w:
                log(f"cycle: {n} events, {linked_a} alarms linked, {linked_w} work orders linked "
                    f"({time.time() - started:.1f}s)")
        except Exception as e:  # keep the service alive; the next cycle retries idempotently
            log("cycle failed:", repr(e))
            try:
                pg.rollback()
            except psycopg.Error:
                pg = psycopg.connect(PG_DSN)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
