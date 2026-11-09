import { Q } from "../kg.js";
import { Stat, href } from "../ui.jsx";

export default function Story({ kg, meta }) {
  const alarms = kg.byLabel("Alarm").length;
  const deviations = kg.byLabel("Batch").filter((b) => b.props.status === "COMPLETE_WITH_DEVIATION").length;
  return (
    <>
      <section className="hero">
        <div>
          <h2>One graph for plant structure, recipes and batch execution</h2>
          <p>
            This knowledge graph describes Process Cell PC-01 (Compounding) along ISA-88. It links the physical model
            (units, equipment modules, control modules), the master recipes and every batch that ran, together with material
            lots, alarms and maintenance records. Engineering, maintenance and production can then ask questions that cut across
            all of these.
          </p>
          <p>
            The analytics pages below are built on top of the graph: every table and chart is a traversal of it, and the Cypher
            query that answers the same question in Neo4j is shown next to it.
          </p>
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            All data is simulated: equipment, recipes, batches and lots are assumptions. No company data is used.
          </p>
        </div>
        <div className="card">
          <Architecture />
        </div>
      </section>

      <div className="grid g4" style={{ marginBottom: 24 }}>
        <Stat label="Batches" value={`${meta.batches.length} (${meta.batches[0]} – ${meta.batches.at(-1)})`} />
        <Stat label="Graph" value={`${kg.nodes.size} nodes · ${kg.rels.length} rels`} />
        <Stat label="Alarms · deviations" value={`${alarms} · ${deviations}`} />
        <Stat label="Process values (time series)" value={meta.processValues.toLocaleString("en-US")} />
      </div>

      <h3 style={{ margin: "0 0 12px" }}>The golden story in three questions</h3>
      <div className="grid g3">
        <Step n={1} title="Traceability" to={href("trace", { batch: "B-0412" })} cta="Trace B-0412">
          Batch <b>B-0412</b> (Citrus Base) raises a HIHI alarm on TT-101 during <i>Hold</i>. Which raw-material lots went in,
          and which product lots and downstream batches (B-0413, B-0414) are affected?
        </Step>
        <Step n={2} title="Fault analysis" to={href("fault", { cm: "TT101" })} cta="Analyse TT-101">
          TT-101 had already raised warnings in B-0400 and B-0406. Work order WO-76890 found "no fault" at the time. The
          per-batch peaks show the drift building up on the old transmitter.
        </Step>
        <Step n={3} title="Maintenance knowledge" to={href("maint", { model: "TX-200" })} cta="Check model TX-200">
          WO-77012 replaced the transmitter, a model TX-200. The same model is still installed at <b>TT-301</b>, which drifted
          before, so the graph recommends a calibration check there.
        </Step>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Explore the graph</h3>
          <p className="hint">Walk the nodes and relationships behind the story, from the enterprise down to a single alarm.</p>
          <div className="row">
            <a className="btn primary" href={href("graph", { view: "story" })} style={{ textDecoration: "none" }}>Open the B-0412 subgraph</a>
            <a className="btn" href={href("graph", { view: "physical" })} style={{ textDecoration: "none" }}>ISA-88 physical model</a>
          </div>
        </div>
        <div className="card">
          <h3>Data model & sources</h3>
          <p className="hint">Schema of the graph, node counts, data-quality checks and the full Neo4j export.</p>
          <a className="btn" href={href("model")} style={{ textDecoration: "none" }}>Open data model</a>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 16 }}>Recipes in the graph: {kg.byLabel("MasterRecipe").map((r) => `${r.props.name} v${r.props.version}`).join(", ")}.
        Latest batch: {Q.batches(kg)[0]}.</p>
    </>
  );
}

function Step({ n, title, children, to, cta }) {
  return (
    <div className="card story-step">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="num">{n}</span><h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      <p>{children}</p>
      <a className="btn go" href={to} style={{ textDecoration: "none", alignSelf: "flex-start" }}>{cta} →</a>
    </div>
  );
}

// Data flow: OT -> DMZ -> IT, one way (ADR-0003). Raw values stay in the time-series store (ADR-0001).
// Master data (master list, recipes, CMMS) is an IT-side input to the sync job, not part of the DMZ.
function Architecture() {
  const box = (x, y, w, title, sub, color) => (
    <g>
      <rect x={x} y={y} width={w} height={46} rx={8} fill="var(--surface-2)" stroke={`var(${color})`} strokeWidth={1.5} />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink)">{title}</text>
      <text x={x + w / 2} y={y + 35} textAnchor="middle" fontSize="10" fill="var(--muted)">{sub}</text>
    </g>
  );
  const arrow = (x1, y1, x2, y2) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--axis)" strokeWidth={1.5} markerEnd="url(#arr)" />;
  return (
    <svg className="arch" viewBox="0 0 420 340" role="img"
      aria-label="Data flow: OT to the DMZ (MQTT broker, ingest, TimescaleDB) to IT, where master data and the sync job build the Neo4j graph">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--axis)" />
        </marker>
      </defs>
      <text x="8" y="16" fontSize="10" fill="var(--muted)" fontWeight="600">L0–3 OT</text>
      <text x="8" y="112" fontSize="10" fill="var(--muted)" fontWeight="600">L3.5 DMZ</text>
      <text x="8" y="208" fontSize="10" fill="var(--muted)" fontWeight="600">L4 IT</text>
      <line x1="0" y1="92" x2="420" y2="92" stroke="var(--grid)" strokeDasharray="3 3" />
      <line x1="0" y1="188" x2="420" y2="188" stroke="var(--grid)" strokeDasharray="3 3" />
      <text x="412" y="88" textAnchor="end" fontSize="9" fill="var(--muted)">firewall</text>
      <text x="412" y="184" textAnchor="end" fontSize="9" fill="var(--muted)">firewall</text>
      {box(20, 26, 170, "PLC / batch system", "simulated scenario", "--s4")}
      {box(230, 26, 170, "Litmus Edge", "UNS topics over MQTT", "--s4")}
      {box(230, 122, 170, "MQTT broker + ingest", "TLS · topic check", "--s3")}
      {box(20, 122, 170, "TimescaleDB", "raw process values", "--s3")}
      {box(20, 218, 170, "Sync job → Neo4j", "structure · events · aggregates", "--s1")}
      {box(230, 218, 170, "Master data", "master list · recipes · CMMS", "--s7")}
      {box(20, 288, 170, "Analytics app", "this site", "--s2")}
      {arrow(190, 49, 228, 49)}
      {arrow(315, 72, 315, 120)}
      {arrow(230, 145, 192, 145)}
      {arrow(105, 168, 105, 216)}
      {arrow(230, 241, 192, 241)}
      {arrow(105, 264, 105, 286)}
      <text x="305" y="306" textAnchor="middle" fontSize="10" fill="var(--muted)">One-way OT → IT,</text>
      <text x="305" y="320" textAnchor="middle" fontSize="10" fill="var(--muted)">nothing writes back</text>
    </svg>
  );
}
