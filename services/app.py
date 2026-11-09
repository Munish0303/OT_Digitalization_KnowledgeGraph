"""Plant Knowledge Graph – demo front end (Purdue level 4, IT).

Context and relationships come from Neo4j; raw process values come from
TimescaleDB by Tag id (ADR-0001). Read-only: nothing here writes to OT (ADR-0003).
"""
import os

import altair as alt
import pandas as pd
import psycopg
import streamlit as st
from neo4j import GraphDatabase

PG_DSN = os.getenv("PG_DSN", "postgresql://postgres:postgres@localhost:5432/plantdata")
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_AUTH = tuple(os.getenv("NEO4J_AUTH", "neo4j/knowledge-graph").split("/", 1))
# Demo filter: only the 30 historical batches (B-0391..B-0420). Live batches added while
# showing Litmus Edge are left out. Empty MAX_BATCH = show everything.
MAX_BATCH = os.getenv("MAX_BATCH", "B-0420") or "B-9999"

st.set_page_config(page_title="Plant Knowledge Graph", page_icon="🧭", layout="wide")


@st.cache_resource
def driver():
    return GraphDatabase.driver(NEO4J_URI, auth=NEO4J_AUTH)


def cypher(query: str, **params) -> pd.DataFrame:
    with driver().session() as s:
        records = s.run(query, **params).data()
    df = pd.DataFrame(records)
    for c in df.columns:  # neo4j DateTime -> pandas (check the first non-null value, not row 0)
        first = next((v for v in df[c] if v is not None), None)
        if hasattr(first, "to_native"):
            df[c] = pd.to_datetime([v.to_native() if v is not None else None for v in df[c]], utc=True)
    return df


def sql(query: str, params=None) -> pd.DataFrame:
    with psycopg.connect(PG_DSN) as conn, conn.cursor() as cur:
        cur.execute(query, params)
        cols = [d.name for d in cur.description]
        return pd.DataFrame(cur.fetchall(), columns=cols)


def fmt_time(df, *cols):
    for c in cols:
        if c in df:  # tolerate all-empty columns; empty cells show as blank
            df[c] = pd.to_datetime(df[c], utc=True, errors="coerce").dt.strftime("%Y-%m-%d %H:%M").fillna("")
    return df


st.title("Plant Knowledge Graph · PC-01 Compounding")
st.caption("ISA-88 knowledge graph in Neo4j, fed from the automation layer via a Litmus Edge stand-in. "
           "**Simulated data**: all equipment, batches and lots are assumptions, no Givaudan data.")

batches = cypher("MATCH (b:Batch) WHERE b.id <= $max RETURN b.id AS id ORDER BY id DESC", max=MAX_BATCH)
if batches.empty:
    st.info("No batches in the graph yet. The sync job runs every 10 s; reload in a moment.")
    st.stop()

tab_trace, tab_fault, tab_maint, tab_ops = st.tabs(
    ["🔎 Batch traceability", "⚠️ Fault analysis", "🔧 Maintenance knowledge", "🩺 Data quality & sync"])

# --- 1. Batch traceability ------------------------------------------------
with tab_trace:
    ids = batches["id"].tolist()
    bid = st.selectbox("Batch", ids, index=ids.index("B-0412") if "B-0412" in ids else 0)
    head = cypher("""
        MATCH (b:Batch {id: $id})-[:FOLLOWS]->(mr:MasterRecipe)
        RETURN mr.name + ' v' + mr.version AS recipe, b.status AS status, b.start AS start, b.end AS end
        """, id=bid)
    if not head.empty:
        h = head.iloc[0]
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Master Recipe", h["recipe"])
        status = {"COMPLETE_WITH_DEVIATION": "Deviation"}.get(h["status"], h["status"].replace("_", " ").title())
        c2.metric("Status", status)
        c3.metric("Start (UTC)", h["start"].strftime("%Y-%m-%d %H:%M"))
        c4.metric("End (UTC)", h["end"].strftime("%Y-%m-%d %H:%M") if pd.notna(h["end"]) else "running")
        if h["status"] == "COMPLETE_WITH_DEVIATION":
            st.error("Deviation: a CRITICAL alarm occurred during this batch. Lots below are candidates for a QA hold.")

    up = cypher("""
        MATCH (b:Batch {id: $id})-[c:CONSUMED]->(l:MaterialLot)-[:OF_MATERIAL]->(m:Material)
        OPTIONAL MATCH (src:Batch)-[:PRODUCED]->(l)
        RETURN l.id AS lot, m.name AS material, c.qtyKg AS qty_kg, src.id AS produced_by
        ORDER BY lot""", id=bid)
    down = cypher("""
        MATCH (b:Batch {id: $id})-[:PRODUCED]->(l:MaterialLot)
        OPTIONAL MATCH (l)<-[c:CONSUMED]-(d:Batch)-[:PRODUCED]->(l2:MaterialLot)
        RETURN l.id AS produced_lot, d.id AS used_in_batch, c.qtyKg AS qty_kg, l2.id AS resulting_lot
        ORDER BY used_in_batch""", id=bid)

    g1, g2 = st.columns(2)
    with g1:
        st.subheader("⬅ Upstream: what went in")
        st.dataframe(up, hide_index=True, use_container_width=True)
    with g2:
        st.subheader("➡ Downstream: where it went")
        st.dataframe(down, hide_index=True, use_container_width=True)

    runs = cypher("""
        MATCH (b:Batch {id: $id})-[:HAS_PHASE_RUN]->(pr:PhaseRun)-[:EXECUTED_ON]->(em:EquipmentModule),
              (pr)-[:INSTANCE_OF]->(ph:Phase)
        OPTIONAL MATCH (a:Alarm)-[:DURING]->(pr)
        OPTIONAL MATCH (pr)-[m:MEASURED]->(:Tag {id: 'TT101.PV'})
        RETURN pr.name AS phase, em.id AS equipment_module, pr.start AS start, pr.end AS end,
               ph.sp_temperature_c AS sp_temp, m.max AS max_tt101,
               collect(a.severity + ': ' + a.message) AS alarms
        ORDER BY start""", id=bid)
    st.subheader("Phase Runs: planned (Master Recipe) vs. actual")
    st.dataframe(fmt_time(runs.copy(), "start", "end"), hide_index=True, use_container_width=True)

    # Process values from the time-series store, located via the graph.
    tags = cypher("""
        MATCH (b:Batch {id: $id})-[:HAS_PHASE_RUN]->(:PhaseRun)-[:EXECUTED_ON]->(:EquipmentModule)
              -[:CONTAINS]->(:ControlModule)-[:HAS_TAG]->(t:Tag)
        RETURN DISTINCT t.id AS tag, t.engUnit AS unit ORDER BY tag""", id=bid)
    if not runs.empty and not tags.empty:
        default = [t for t in tags["tag"] if t.startswith("TT")] or tags["tag"].tolist()[:1]
        chosen = st.multiselect("Process values (from TimescaleDB)", tags["tag"].tolist(), default=default)
        if chosen:
            t0, t1 = runs["start"].min(), (runs["end"].max() if runs["end"].notna().any() else pd.Timestamp.now(tz="UTC"))
            pv = sql("SELECT time, tag_id AS tag, value FROM staging.process_value "
                     "WHERE tag_id = ANY(%s) AND time BETWEEN %s AND %s ORDER BY time",
                     (chosen, t0.to_pydatetime(), t1.to_pydatetime()))
            bands = runs[~runs["phase"].isin(["Agitate", "Mix"])].copy()
            bands["end"] = bands["end"].fillna(t1)
            band_chart = alt.Chart(bands).mark_rect(opacity=0.12).encode(
                x=alt.X("start:T", scale=alt.Scale(type="utc")), x2="end:T", color=alt.Color("phase:N", legend=alt.Legend(title="Phase")))
            line = alt.Chart(pv).mark_line().encode(
                x=alt.X("time:T", title="UTC", scale=alt.Scale(type="utc")), y=alt.Y("value:Q", title=None),
                strokeDash=alt.StrokeDash("tag:N", legend=alt.Legend(title="Tag")))
            chart = band_chart + line
            if "TT101.PV" in chosen:
                limit = pd.DataFrame({"y": [90, 94], "label": ["HI 90", "HIHI 94"]})
                chart += alt.Chart(limit).mark_rule(color="red", strokeDash=[4, 4]).encode(y="y:Q")
            st.altair_chart(chart.properties(height=320), use_container_width=True)

    with st.expander("Graph view of this batch"):
        sub = cypher("""
            MATCH (b:Batch {id: $id})
            OPTIONAL MATCH (b)-[:FOLLOWS]->(mr:MasterRecipe)
            OPTIONAL MATCH (b)-[:HAS_PHASE_RUN]->(pr:PhaseRun)-[:EXECUTED_ON]->(em:EquipmentModule)<-[:CONTAINS]-(u:Unit)
            OPTIONAL MATCH (a:Alarm)-[:DURING]->(pr)
            OPTIONAL MATCH (a)-[:RAISED_BY]->(cm:ControlModule)
            RETURN b.id AS b, mr.name AS mr, pr.name AS pr, em.id AS em, u.id AS u,
                   a.level AS a, cm.id AS cm""", id=bid)
        lots = pd.concat([up.assign(dir="in"), down.assign(dir="out")], ignore_index=True)
        dot = ["digraph G { rankdir=LR; node [shape=box, style=\"rounded,filled\", fontname=Helvetica, fontsize=10];"]
        edges = set()

        def node(n, color):
            dot.append(f'"{n}" [fillcolor="{color}"];')

        node(bid, "#ffd166")
        for _, r in sub.iterrows():
            if r["mr"]:
                node(r["mr"], "#cdb4db"); edges.add((bid, r["mr"], "FOLLOWS"))
            if r["pr"]:
                p = f'{r["pr"]}\\n({r["em"]})'
                node(p, "#bde0fe"); node(r["u"], "#a7c957")
                edges.add((bid, p, "HAS_PHASE_RUN")); edges.add((p, r["u"], "ON UNIT"))
                if r["a"]:
                    al = f'Alarm {r["a"]}\\n{r["cm"]}'
                    node(al, "#ff8fa3"); edges.add((al, p, "DURING"))
        for _, r in up.iterrows():
            node(r["lot"], "#e9edc9"); edges.add((r["lot"], bid, "CONSUMED BY"))
        for _, r in down.iterrows():
            node(r["produced_lot"], "#e9edc9"); edges.add((bid, r["produced_lot"], "PRODUCED"))
            if r["used_in_batch"]:
                node(r["used_in_batch"], "#ffe5a3"); edges.add((r["produced_lot"], r["used_in_batch"], "CONSUMED BY"))
        for a, b, lbl in sorted(edges):
            dot.append(f'"{a}" -> "{b}" [label="{lbl}", fontsize=8, fontname=Helvetica];')
        dot.append("}")
        st.graphviz_chart("\n".join(dot), use_container_width=True)

# --- 2. Fault analysis -----------------------------------------------------
with tab_fault:
    cms = cypher("MATCH (cm:ControlModule)-[:HAS_TAG]->() RETURN DISTINCT cm.id AS id ORDER BY id")["id"].tolist()
    cm = st.selectbox("Control Module", cms, index=cms.index("TT101") if "TT101" in cms else 0)
    alarms = cypher("""
        MATCH (a:Alarm)-[:RAISED_BY]->(cm:ControlModule {id: $cm})
        OPTIONAL MATCH (a)-[:DURING]->(pr:PhaseRun)<-[:HAS_PHASE_RUN]-(b:Batch)
        OPTIONAL MATCH (d:PhysicalDevice)-[i:INSTALLED_AT]->(cm)
          WHERE i.from <= a.time AND (i.to IS NULL OR a.time < i.to)
        OPTIONAL MATCH (w:WorkOrder)-[:TRIGGERED_BY]->(a)
        RETURN a.time AS time, b.id AS batch, pr.name AS phase, a.severity AS severity, a.value AS value,
               d.serial AS device, d.model AS model, w.id AS work_order, w.failureCode AS failure_code
        ORDER BY time""", cm=cm)
    st.subheader(f"Alarm history of {cm} across batches")
    if alarms.empty:
        st.info("No alarms recorded for this Control Module.")
    else:
        st.dataframe(fmt_time(alarms.copy(), "time"), hide_index=True, use_container_width=True)

    trend = cypher("""
        MATCH (cm:ControlModule {id: $cm})-[:HAS_TAG]->(t:Tag)
        MATCH (b:Batch)-[:HAS_PHASE_RUN]->(pr:PhaseRun)-[m:MEASURED]->(t)
        WHERE b.id <= $max
        OPTIONAL MATCH (d:PhysicalDevice)-[i:INSTALLED_AT]->(cm)
          WHERE i.from <= pr.start AND (i.to IS NULL OR pr.start < i.to)
        RETURN b.id AS batch, pr.name AS phase, t.id AS tag, m.max AS max, m.avg AS avg, d.serial AS device
        ORDER BY batch""", cm=cm, max=MAX_BATCH)
    if not trend.empty:
        st.subheader("Per-batch aggregates (stored on the graph as MEASURED relationships)")
        ph = st.selectbox("Phase", sorted(trend["phase"].unique()),
                          index=sorted(trend["phase"].unique()).index("Hold") if "Hold" in trend["phase"].values else 0)
        t = trend[trend["phase"] == ph]
        st.altair_chart(alt.Chart(t).mark_bar().encode(
            x=alt.X("batch:N", sort=None), y=alt.Y("max:Q", title="max value in phase"),
            color=alt.Color("device:N", title="Installed device"), tooltip=["batch", "max", "avg", "device"]
        ).properties(height=280), use_container_width=True)
        st.caption("Read it as: the peaks rise batch after batch on the old transmitter and disappear "
                   "after the replacement. The warnings in B-0400 and B-0406 were early signals.")

# --- 3. Maintenance knowledge ---------------------------------------------
with tab_maint:
    models = cypher("MATCH (d:PhysicalDevice) RETURN DISTINCT d.model AS m ORDER BY m")["m"].tolist()
    model = st.selectbox("Device model", models, index=models.index("TX-200") if "TX-200" in models else 0)
    inst = cypher("""
        MATCH (d:PhysicalDevice {model: $m})-[i:INSTALLED_AT]->(cm:ControlModule)<-[:CONTAINS]-(:EquipmentModule)<-[:CONTAINS]-(u:Unit)
        OPTIONAL MATCH (w:WorkOrder)-[:ON]->(cm)
          WHERE w.created >= i.from AND (i.to IS NULL OR w.created <= i.to)
        RETURN d.serial AS serial, cm.id AS position, u.id AS unit, i.from AS installed, i.to AS removed,
               w.id AS work_order, w.failureCode AS code, w.description AS finding
        ORDER BY position, installed, work_order""", m=model)
    st.subheader(f"Where model {model} is or was installed, with its maintenance history")
    st.dataframe(fmt_time(inst.copy(), "installed", "removed"), hide_index=True, use_container_width=True)

    rec = cypher("""
        MATCH (:PhysicalDevice {model: $m})-[i:INSTALLED_AT]->(cm:ControlModule)<-[:ON]-(w:WorkOrder {failureCode: 'DRIFT'})
        WHERE w.created >= i.from AND (i.to IS NULL OR w.created <= i.to)
        WITH count(DISTINCT w) AS drifts, collect(DISTINCT cm.id) AS where
        MATCH (d:PhysicalDevice {model: $m})-[i:INSTALLED_AT]->(cm:ControlModule)
        WHERE i.to IS NULL
        RETURN drifts, where, collect(cm.id + ' (' + d.serial + ')') AS still_installed""", m=model)
    if not rec.empty and rec.iloc[0]["drifts"] >= 2 and rec.iloc[0]["still_installed"]:
        r = rec.iloc[0]
        st.warning(f"**Recommendation:** model {model} has {r['drifts']} drift findings "
                   f"({', '.join(r['where'])}). Still installed at: {', '.join(r['still_installed'])}. "
                   "Schedule a calibration check before the next batch.")

# --- 4. Data quality & sync ------------------------------------------------
with tab_ops:
    c1, c2 = st.columns(2)
    with c1:
        st.subheader("Graph content")
        st.dataframe(cypher("""
            MATCH (n) UNWIND labels(n) AS label
            RETURN label, count(*) AS nodes ORDER BY nodes DESC"""), hide_index=True, use_container_width=True)
    with c2:
        st.subheader("Sync watermark")
        st.dataframe(sql("SELECT source, last_id, last_run FROM ops.sync_watermark"), hide_index=True)
        st.dataframe(sql("SELECT count(*) AS process_values, max(time) AS latest FROM staging.process_value"),
                     hide_index=True)
        st.subheader("Topics not in the Engineering Master List (ADR-0002)")
        unk = sql("SELECT topic, first_seen, last_seen, msg_count FROM ops.unknown_topic ORDER BY last_seen DESC")
        if unk.empty:
            st.success("All incoming topics match the master list.")
        else:
            st.warning("Unregistered equipment is publishing data; it was NOT added to the graph automatically.")
            st.dataframe(unk, hide_index=True, use_container_width=True)
