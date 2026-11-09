import { useMemo, useState } from "react";
import GraphCanvas from "../components/GraphCanvas.jsx";
import { CYPHER, KG, Q } from "../kg.js";
import { Callout, Cypher, Stat, Table, fmtTime } from "../ui.jsx";

export default function DataModel({ kg, meta }) {
  const labels = Q.labelCounts(kg);
  const rels = Q.relCounts(kg);
  const schema = useMemo(() => Q.schema(kg), [kg]);
  const schemaKg = useMemo(() => {
    const ls = [...new Set(schema.flatMap((s) => [s.from, s.to]))];
    return new KG({
      nodes: ls.map((l) => ({ key: l, labels: [l], props: { id: l } })),
      relationships: schema.map((s, i) => ({ id: i, type: s.type, start: s.from, end: s.to, props: { count: s.count } })),
    });
  }, [schema]);
  const schemaKeys = useMemo(() => [...schemaKg.nodes.keys()], [schemaKg]);
  const [sel, setSel] = useState(null);

  return (
    <>
      <div className="page-head">
        <h2>Data model & sources</h2>
        <p>What is in the graph, how it is connected, and how this static site relates to the full Docker stack.</p>
      </div>
      <div className="stack">
        <div className="grid g4">
          <Stat label="Nodes" value={kg.nodes.size} />
          <Stat label="Relationships" value={kg.rels.length} />
          <Stat label="Batch events replayed" value={meta.events} />
          <Stat label="Process values (outside the graph)" value={meta.processValues.toLocaleString("en-US")} />
        </div>

        <div className="card">
          <h3>Graph schema</h3>
          <p className="hint">Every label and relationship type that occurs in the data (the equivalent of <span className="mono">db.schema.visualization()</span>).</p>
          <div style={{ position: "relative", height: 520, border: "1px solid var(--border)", borderRadius: 8 }}>
            <GraphCanvas kg={schemaKg} keys={schemaKeys} selected={sel} onSelect={setSel} layout="fcose" edgeLabels captionFn={(n) => n.props.id} />
          </div>
        </div>

        <div className="grid g2">
          <div className="card">
            <h3>Nodes by label</h3>
            <Table rows={labels} columns={[{ key: "label" }, { key: "nodes", num: true }]} />
            <Cypher query={CYPHER.labels} />
          </div>
          <div className="card">
            <h3>Relationships by type</h3>
            <Table rows={rels} columns={[{ key: "type", render: (r) => <span className="mono">{r.type}</span> }, { key: "count", num: true }]} />
          </div>
        </div>

        <div className="grid g2">
          <div className="card">
            <h3>Data quality</h3>
            <div className="stack" style={{ gap: 10 }}>
              {meta.allTopicsInMasterList ? (
                <Callout tone="good">All {meta.tagsInMasterList} tags in the tag list belong to a Control Module in the Engineering Master List.</Callout>
              ) : (
                <Callout tone="warning">Some tags reference Control Modules that are not in the Engineering Master List.</Callout>
              )}
              {meta.unknownTopics.length === 0 ? (
                <Callout tone="good">No unregistered topics in this snapshot. In live mode, a newly commissioned transmitter (TT-305)
                  publishes without being in the master list. It is flagged for review and not added to the graph (ADR-0002).</Callout>
              ) : (
                <Callout tone="warning">{meta.unknownTopics.length} topic(s) not in the master list.</Callout>
              )}
              <Callout tone="info">Every alarm is linked to the Phase Run that was active on its equipment, and every work order with an alarm
                reference is linked to that alarm: {kg.rels.filter((r) => r.type === "DURING").length} of {kg.byLabel("Alarm").length} alarms,
                {" "}{kg.rels.filter((r) => r.type === "TRIGGERED_BY").length} work orders.</Callout>
            </div>
          </div>
          <div className="card">
            <h3>Design decisions</h3>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)" }}>
              <li><b>ADR-0001</b> No raw time series in Neo4j. The graph holds structure, events and per-phase aggregates; each Tag points to its series in the time-series store.</li>
              <li><b>ADR-0002</b> The Engineering Master List owns the hierarchy. Unknown topics are flagged, never added automatically.</li>
              <li><b>ADR-0003</b> One-way OT → IT. Nothing in IT writes back to the plant floor.</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <h3>About this deliverable</h3>
          <p style={{ color: "var(--ink-2)", marginTop: 4 }}>
            The full prototype runs as a Docker stack: an edge simulator publishes Litmus Edge payloads over MQTT, an ingest service
            writes them to TimescaleDB, and a sync job builds the graph in Neo4j. For this hosted version the same deterministic
            scenario is replayed offline for the {meta.batches.length} historical batches ({meta.batches[0]} – {meta.batches.at(-1)}),
            using the same graph rules as the sync job. The result is exported as static files, and the app queries the graph in the browser.
          </p>
          <div className="row">
            <a className="btn" href="/data/graph.json" download>Download graph.json</a>
            <a className="btn" href="/data/graph.cypher" download>Download graph.cypher (load into Neo4j)</a>
          </div>
          <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>Scenario start {fmtTime(meta.anchor)} UTC · built {fmtTime(meta.built)} UTC.</p>
        </div>
      </div>
    </>
  );
}
