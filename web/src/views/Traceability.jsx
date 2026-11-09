import { useEffect, useMemo, useState } from "react";
import GraphCanvas from "../components/GraphCanvas.jsx";
import ProcessChart from "../components/ProcessChart.jsx";
import { CYPHER, Q, loadProcessValues } from "../kg.js";
import { Callout, Cypher, NodeLink, Stat, Table, fmtTime, href, setParam } from "../ui.jsx";

const STATUS = { COMPLETE_WITH_DEVIATION: "Deviation", COMPLETE: "Complete", RUNNING: "Running" };
const BatchLink = ({ id }) => (id ? <a className="link" href={href("trace", { batch: id })}>{id}</a> : null);

export default function Traceability({ kg, params }) {
  const ids = useMemo(() => Q.batches(kg), [kg]);
  const [bid, setBid] = useState(ids.includes(params.batch) ? params.batch : "B-0412");
  useEffect(() => { if (params.batch && ids.includes(params.batch)) setBid(params.batch); }, [params.batch, ids]);
  const choose = (v) => { setBid(v); setParam("trace", params, "batch", v); };

  const h = Q.batchHeader(kg, bid);
  const up = Q.upstream(kg, bid);
  const down = Q.downstream(kg, bid);
  const runs = Q.phaseRuns(kg, bid);
  const tags = Q.batchTags(kg, bid);
  const deviation = h.status === "COMPLETE_WITH_DEVIATION";

  return (
    <>
      <div className="page-head">
        <h2>Batch traceability</h2>
        <p>Pick a batch: the graph answers what went in, where the product went, which phases ran on which equipment,
          and which alarms occurred. Process values are fetched from the time-series store by Tag id.</p>
      </div>
      <div className="stack">
        <div className="row">
          <div className="field">
            <label htmlFor="batch">Batch</label>
            <select id="batch" value={bid} onChange={(e) => choose(e.target.value)}>
              {ids.map((i) => {
                const st = kg.get(`Batch:${i}`).props.status;
                return <option key={i} value={i}>{i}{st === "COMPLETE_WITH_DEVIATION" ? " · deviation" : ""}</option>;
              })}
            </select>
          </div>
          <NodeLink nodeKey={`Batch:${bid}`}>Show {bid} in the knowledge graph →</NodeLink>
        </div>

        <div className="grid g4">
          <Stat label="Master Recipe" value={h.recipe} />
          <Stat label="Status" value={STATUS[h.status] ?? h.status} />
          <Stat label="Start (UTC)" value={fmtTime(h.start)} />
          <Stat label="End (UTC)" value={h.end ? fmtTime(h.end) : "running"} />
        </div>
        {deviation && (
          <Callout tone="critical">
            <b>Deviation:</b> a CRITICAL alarm occurred during this batch. The lots below are candidates for a QA hold,
            including {down.filter((d) => d.resulting_lot).map((d) => d.resulting_lot).join(" and ") || "none downstream"}.
          </Callout>
        )}

        <div className="grid g2">
          <div className="card">
            <h3>Upstream: what went in</h3>
            <p className="hint">Material lots consumed by {bid}, and the batch that produced them.</p>
            <Table rows={up} columns={[
              { key: "lot", render: (r) => <NodeLink nodeKey={`MaterialLot:${r.lot}`} /> },
              { key: "material" },
              { key: "qty_kg", label: "qty (kg)", num: true },
              { key: "produced_by", label: "produced by", render: (r) => <BatchLink id={r.produced_by} /> },
            ]} />
            <Cypher query={CYPHER.upstream} />
          </div>
          <div className="card">
            <h3>Downstream: where it went</h3>
            <p className="hint">Lots produced by {bid}, and the batches that consumed them.</p>
            <Table rows={down} columns={[
              { key: "produced_lot", label: "produced lot", render: (r) => <NodeLink nodeKey={`MaterialLot:${r.produced_lot}`} /> },
              { key: "used_in_batch", label: "used in batch", render: (r) => <BatchLink id={r.used_in_batch} /> },
              { key: "qty_kg", label: "qty (kg)", num: true },
              { key: "resulting_lot", label: "resulting lot" },
            ]} empty="Not consumed by any later batch (finished good)." />
            <Cypher query={CYPHER.downstream} />
          </div>
        </div>

        <div className="card">
          <h3>Phase runs: planned (Master Recipe) vs. actual</h3>
          <p className="hint">Each Phase Run is an instance of a recipe Phase and ran on one Equipment Module. Alarms are linked to the run that was active.</p>
          <Table rows={runs} columns={[
            { key: "phase", render: (r) => <NodeLink nodeKey={`PhaseRun:${r.id}`}>{r.phase}</NodeLink> },
            { key: "equipment_module", label: "equipment module" },
            { key: "start", render: (r) => fmtTime(r.start) },
            { key: "end", render: (r) => fmtTime(r.end) },
            { key: "setpoints", label: "setpoints", render: (r) => kv(r.setpoints) },
            { key: "actuals", label: "actuals", render: (r) => kv(r.actuals) },
            { key: "max_tt101", label: "max TT101", num: true },
            { key: "alarms", render: (r) => r.alarms.length ? r.alarms.map((a) => <div key={a.message} className={`sev ${a.severity}`}>{a.severity}: {a.message}</div>) : null },
          ]} />
          <Cypher query={CYPHER.phaseRuns} />
        </div>

        <ProcessValues kg={kg} bid={bid} runs={runs} tags={tags} />

        <div className="card">
          <h3>Graph view of {bid}</h3>
          <p className="hint">The subgraph behind this page. Click a node to highlight its relationships.</p>
          <BatchGraph kg={kg} bid={bid} />
        </div>
      </div>
    </>
  );
}

function kv(o) {
  const e = Object.entries(o).filter(([k]) => k !== "duration_min");
  return e.length ? <span className="mono">{e.map(([k, v]) => `${k}=${v}`).join(", ")}</span> : null;
}

function ProcessValues({ kg, bid, runs, tags }) {
  const [pv, setPv] = useState(null);
  const [chosen, setChosen] = useState([]);
  useEffect(() => {
    let live = true;
    setPv(null);
    loadProcessValues(bid).then((d) => live && setPv(d));
    const tt = tags.filter((t) => t.id.startsWith("TT")).map((t) => t.id);
    setChosen(tt.length ? tt : tags.slice(0, 1).map((t) => t.id));
    return () => { live = false; };
  }, [bid, kg]); // eslint-disable-line react-hooks/exhaustive-deps

  const t0 = Date.parse(runs[0]?.start);
  const t1 = Math.max(...runs.map((r) => Date.parse(r.end)));
  const bands = runs.filter((r) => !["AGITATE", "MIX"].includes(r.type))
    .map((r) => ({ phase: r.phase, start: Date.parse(r.start), end: Date.parse(r.end) }));

  return (
    <div className="card">
      <h3>Process values</h3>
      <p className="hint">The graph lists the Tags on the equipment this batch ran on; raw values come from the time-series store
        (here: <span className="mono">/data/pv/{bid}.json</span>, in the full stack: TimescaleDB). Bands show the phase runs.</p>
      <div className="chips" role="group" aria-label="Tags">
        {tags.map((t) => {
          const on = chosen.includes(t.id);
          return (
            <button key={t.id} className="chip" aria-pressed={on}
              onClick={() => setChosen((c) => (on ? c.filter((x) => x !== t.id) : [...c, t.id]))}>{t.id}</button>
          );
        })}
      </div>
      <div className="stack" style={{ marginTop: 12 }}>
        {!pv && <p className="hint">Loading process values…</p>}
        {pv && chosen.map((id) => {
          const tag = tags.find((t) => t.id === id);
          const start = Date.parse(pv.start);
          const points = (pv.series[id] || []).map(([m, v]) => ({ t: start + m * 60000, v }));
          return points.length ? <ProcessChart key={id} tag={tag} points={points} bands={bands} t0={t0} t1={t1} /> : null;
        })}
      </div>
      <Cypher query={CYPHER.tags} title="Cypher: which tags to fetch" />
    </div>
  );
}

function BatchGraph({ kg, bid }) {
  const [sel, setSel] = useState(null);
  const keys = useMemo(() => {
    const s = new Set([`Batch:${bid}`]);
    const b = `Batch:${bid}`;
    kg.out(b, "FOLLOWS").forEach((x) => s.add(x.node.key));
    for (const { node: pr } of kg.out(b, "HAS_PHASE_RUN")) {
      s.add(pr.key);
      for (const { node: em } of kg.out(pr.key, "EXECUTED_ON")) { s.add(em.key); kg.inc(em.key, "CONTAINS").forEach((x) => s.add(x.node.key)); }
      for (const { node: a } of kg.inc(pr.key, "DURING")) { s.add(a.key); kg.out(a.key, "RAISED_BY").forEach((x) => s.add(x.node.key)); }
    }
    kg.out(b, "CONSUMED").forEach((x) => s.add(x.node.key));
    for (const { node: l } of kg.out(b, "PRODUCED")) {
      s.add(l.key);
      kg.inc(l.key, "CONSUMED").forEach((x) => s.add(x.node.key));
    }
    return [...s];
  }, [kg, bid]);
  return (
    <div style={{ position: "relative", height: 460, border: "1px solid var(--border)", borderRadius: 8 }}>
      <GraphCanvas kg={kg} keys={keys} selected={sel} onSelect={setSel} layout="fcose" hideTypes={["MEASURED"]} />
    </div>
  );
}
