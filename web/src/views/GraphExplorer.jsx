import { Fragment, useEffect, useMemo, useState } from "react";
import GraphCanvas from "../components/GraphCanvas.jsx";
import { caption, kind } from "../kg.js";
import { DOMAINS, cssVar, domainOf, fmtTime, href, setParam, useTheme } from "../ui.jsx";

const PRESETS = [
  { id: "story", name: "Batch B-0412 incident", desc: "Recipe, phase runs, alarms, device, work orders, lots in and out", layout: "fcose" },
  { id: "physical", name: "ISA-88 physical model", desc: "Enterprise → Control Module, with tags", layout: "tb" },
  { id: "recipes", name: "Master recipes", desc: "Procedural model linked to the equipment it runs on", layout: "lr" },
  { id: "tt101", name: "TT-101 maintenance context", desc: "Devices, alarms, work orders and the TX-200 model", layout: "fcose" },
  { id: "genealogy", name: "Material genealogy", desc: "All batches and lots, B-0391 to B-0420", layout: "fcose" },
  { id: "all", name: "Whole graph", desc: "Every node; per-tag aggregates hidden by default", layout: "fcose" },
];

function presetKeys(kg, id) {
  const keys = new Set();
  const add = (n) => n && keys.add(n.key ?? n);
  const each = (key, type, dir = "out") => (dir === "out" ? kg.out(key, type) : kg.inc(key, type)).map((x) => x.node);
  if (id === "physical") {
    kg.byLabel("Equipment").forEach(add);
    kg.byLabel("Tag").forEach(add);
  } else if (id === "recipes") {
    for (const mr of kg.byLabel("MasterRecipe")) {
      add(mr); each(mr.key, "MAKES").forEach(add);
      for (const up of each(mr.key, "HAS_UNIT_PROCEDURE")) {
        add(up); each(up.key, "RUNS_ON").forEach(add);
        for (const op of each(up.key, "HAS_OPERATION")) {
          add(op);
          for (const ph of each(op.key, "HAS_PHASE")) { add(ph); each(ph.key, "RUNS_ON").forEach(add); }
        }
      }
    }
  } else if (id === "story") {
    const b = "Batch:B-0412";
    add(b); each(b, "FOLLOWS").forEach(add);
    for (const pr of each(b, "HAS_PHASE_RUN")) {
      add(pr); each(pr.key, "EXECUTED_ON").forEach(add);
      for (const a of each(pr.key, "DURING", "in")) {
        add(a);
        for (const cm of each(a.key, "RAISED_BY")) { add(cm); each(cm.key, "INSTALLED_AT", "in").forEach(add); }
        each(a.key, "TRIGGERED_BY", "in").forEach(add);
      }
    }
    for (const l of each(b, "CONSUMED")) add(l);
    for (const l of each(b, "PRODUCED")) {
      add(l);
      for (const d of each(l.key, "CONSUMED", "in")) { add(d); each(d.key, "PRODUCED").forEach(add); }
    }
  } else if (id === "tt101") {
    const cm = "Equipment:TT101";
    add(cm); each(cm, "CONTAINS", "in").forEach(add); each(cm, "HAS_TAG").forEach(add);
    for (const d of each(cm, "INSTALLED_AT", "in")) add(d);
    for (const w of each(cm, "ON", "in")) { add(w); each(w.key, "TRIGGERED_BY").forEach(add); }
    for (const a of each(cm, "RAISED_BY", "in")) {
      add(a);
      for (const pr of each(a.key, "DURING")) { add(pr); each(pr.key, "HAS_PHASE_RUN", "in").forEach(add); }
    }
    for (const d of kg.byLabel("PhysicalDevice").filter((d) => d.props.model === "TX-200")) {
      add(d);
      for (const c of each(d.key, "INSTALLED_AT")) { add(c); each(c.key, "ON", "in").forEach(add); }
    }
  } else if (id === "genealogy") {
    kg.byLabel("Batch").forEach(add);
    kg.byLabel("MaterialLot").forEach(add);
  } else {
    kg.nodes.forEach((n) => add(n));
  }
  return [...keys];
}

function neighbours(kg, key) {
  return [...kg.out(key), ...kg.inc(key)].map((x) => x.node.key);
}

export default function GraphExplorer({ kg, params }) {
  const theme = useTheme();
  const [preset, setPreset] = useState(params.focus ? "custom" : params.view || "story");
  const [extra, setExtra] = useState(() => (params.focus && kg.get(params.focus) ? [params.focus, ...neighbours(kg, params.focus)] : []));
  const [selected, setSelected] = useState(params.focus && kg.get(params.focus) ? params.focus : null);
  const [hidden, setHidden] = useState([]);
  const [showMeasured, setShowMeasured] = useState(false);
  const [query, setQuery] = useState("");

  // follow links from the analytics views (#/graph?focus=...)
  useEffect(() => {
    if (params.focus && kg.get(params.focus)) {
      setPreset("custom");
      setExtra([params.focus, ...neighbours(kg, params.focus)]);
      setSelected(params.focus);
    }
  }, [params.focus, kg]);

  const base = useMemo(() => (preset === "custom" ? [] : presetKeys(kg, preset)), [kg, preset]);
  const keys = useMemo(() => {
    const all = [...new Set([...base, ...extra])];
    return all.filter((k) => !hidden.includes(domainOf(kind(kg.get(k))).id));
  }, [base, extra, hidden, kg]);
  const layout = preset === "custom" ? "fcose" : PRESETS.find((p) => p.id === preset)?.layout;
  const hideTypes = useMemo(() => (showMeasured || keys.length < 60 ? [] : ["MEASURED"]), [showMeasured, keys.length]);

  const choosePreset = (id) => {
    setPreset(id); setExtra([]); setSelected(null);
    setParam("graph", {}, "view", id);
  };
  const expand = (key) => setExtra((e) => [...new Set([...e, key, ...neighbours(kg, key)])]);
  const focusNode = (key) => {
    if (!keys.includes(key)) setExtra((e) => [...new Set([...e, key])]);
    setSelected(key);
  };

  const searchIndex = useMemo(() => [...kg.nodes.values()].map((n) => ({ key: n.key, text: `${caption(n)} · ${kind(n)}` })), [kg]);
  const onSearch = (v) => {
    setQuery(v);
    const hit = searchIndex.find((s) => s.text === v);
    if (hit) { setPreset("custom"); setExtra([hit.key, ...neighbours(kg, hit.key)]); setSelected(hit.key); setQuery(""); }
  };

  const node = selected ? kg.get(selected) : null;

  return (
    <>
      <div className="page-head">
        <h2>Knowledge graph</h2>
        <p>The graph that the analytics run on: ISA-88 physical and procedural models, batch execution, material lots,
          alarms and maintenance, connected in one model. Click a node to inspect it; expand it to walk the graph.</p>
      </div>
      <div className="explorer">
        <div className="card">
          <div className="section-title">Views</div>
          {PRESETS.map((p) => (
            <button key={p.id} className={`preset ${preset === p.id ? "active" : ""}`} onClick={() => choosePreset(p.id)}>
              <b>{p.name}</b><span>{p.desc}</span>
            </button>
          ))}
          <div className="section-title">Find a node</div>
          <input type="search" list="node-index" placeholder="e.g. B-0412, TT101, WO-77012" value={query}
            onChange={(e) => onSearch(e.target.value)} style={{ width: "100%" }} aria-label="Find a node" />
          <datalist id="node-index">{searchIndex.map((s) => <option key={s.key} value={s.text} />)}</datalist>
          <div className="section-title">Layers</div>
          <div className="chips">
            {DOMAINS.map((d) => {
              const on = !hidden.includes(d.id);
              return (
                <button key={d.id} className="chip" aria-pressed={on}
                  onClick={() => setHidden((h) => (on ? [...h, d.id] : h.filter((x) => x !== d.id)))}>
                  <span className="sw" style={{ background: `var(${d.color})`, opacity: on ? 1 : 0.3 }} />{d.name}
                </button>
              );
            })}
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 12, color: "var(--ink-2)" }}>
            <input type="checkbox" checked={showMeasured} onChange={(e) => setShowMeasured(e.target.checked)} />
            Show MEASURED aggregates in large views
          </label>
        </div>

        <div className="card canvas-card">
          {keys.length ? (
            <GraphCanvas kg={kg} keys={keys} selected={selected} onSelect={setSelected} layout={layout}
              hideTypes={hideTypes} fitKey={selected} key={theme} />
          ) : <div className="loading">Pick a view or search for a node.</div>}
          <div className="canvas-count">{keys.length} nodes</div>
        </div>

        <div className="card">
          {node ? <Inspector kg={kg} node={node} onPick={focusNode} onExpand={expand} />
            : <InspectorEmpty kg={kg} />}
        </div>
      </div>
    </>
  );
}

function InspectorEmpty({ kg }) {
  return (
    <>
      <div className="section-title">Inspector</div>
      <p className="hint">Select a node to see its labels, properties and relationships.</p>
      <div className="section-title">Graph size</div>
      <dl className="props">
        <dt>Nodes</dt><dd>{kg.nodes.size}</dd>
        <dt>Relationships</dt><dd>{kg.rels.length}</dd>
      </dl>
      <div className="section-title">Legend</div>
      <div className="stack" style={{ gap: 6 }}>
        {DOMAINS.map((d) => (
          <div key={d.id} style={{ fontSize: 12 }}>
            <span className="label-pill"><span className="sw" style={{ width: 9, height: 9, borderRadius: 3, background: `var(${d.color})` }} />{d.name}</span>
            <span style={{ color: "var(--muted)" }}>{d.labels.join(", ")}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function fmtProp(v) {
  if (v == null) return "null";
  if (typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return `${fmtTime(v)} UTC`;
  return String(v);
}

function analyticsLink(kg, node) {
  const k = kind(node);
  if (k === "Batch") return { to: href("trace", { batch: node.props.id }), text: "Open batch traceability" };
  if (k === "PhaseRun") return { to: href("trace", { batch: node.props.id.split(".")[0] }), text: "Open batch traceability" };
  if (k === "ControlModule" && kg.out(node.key, "HAS_TAG").length) return { to: href("fault", { cm: node.props.id }), text: "Open fault analysis" };
  if (k === "Alarm") return { to: href("fault", { cm: node.props.tagId.split(".")[0] }), text: "Open fault analysis" };
  if (k === "PhysicalDevice") return { to: href("maint", { model: node.props.model }), text: `Open maintenance view for ${node.props.model}` };
  return null;
}

function Inspector({ kg, node, onPick, onExpand }) {
  const k = kind(node);
  const out = kg.out(node.key);
  const inc = kg.inc(node.key);
  const link = analyticsLink(kg, node);
  const group = (list) => {
    const m = new Map();
    for (const x of list) { if (!m.has(x.rel.type)) m.set(x.rel.type, []); m.get(x.rel.type).push(x); }
    return [...m];
  };
  return (
    <>
      <div className="section-title">Inspector</div>
      <h3 style={{ margin: "0 0 6px", overflowWrap: "anywhere" }}>{caption(node)}</h3>
      <div>
        {node.labels.map((l) => (
          <span key={l} className="label-pill">
            <span style={{ width: 9, height: 9, borderRadius: 3, background: cssVar(domainOf(l === "Equipment" ? k : l).color) }} />{l}
          </span>
        ))}
      </div>
      <div className="row" style={{ margin: "8px 0 4px" }}>
        <button className="btn small" onClick={() => onExpand(node.key)}>Expand neighbours ({kg.degree(node.key)})</button>
        {link && <a className="btn small" href={link.to} style={{ textDecoration: "none" }}>{link.text} →</a>}
      </div>
      <div className="section-title">Properties</div>
      <dl className="props">
        {Object.entries(node.props).map(([p, v]) => (<Fragment key={p}><dt>{p}</dt><dd>{fmtProp(v)}</dd></Fragment>))}
      </dl>
      {[["Outgoing", out, "→"], ["Incoming", inc, "←"]].map(([title, list, arrow]) => list.length > 0 && (
        <div key={title}>
          <div className="section-title">{title} ({list.length})</div>
          {group(list).map(([type, items]) => (
            <ul className="rel-list" key={type}>
              {items.slice(0, 40).map(({ rel, node: other }) => (
                <li key={rel.id}>
                  <span className="rel-type">{arrow} {type}</span>
                  <button className="link" onClick={() => onPick(other.key)}>{caption(other)}</button>
                  {Object.keys(rel.props).length > 0 && (
                    <span style={{ color: "var(--muted)" }}>
                      {Object.entries(rel.props).filter(([, v]) => v != null).map(([p, v]) => `${p}: ${typeof v === "string" && v.includes("T") ? fmtTime(v) : v}`).join(", ")}
                    </span>
                  )}
                </li>
              ))}
              {items.length > 40 && <li style={{ color: "var(--muted)" }}>… {items.length - 40} more</li>}
            </ul>
          ))}
        </div>
      ))}
    </>
  );
}
