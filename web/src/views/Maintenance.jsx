import { useEffect, useMemo, useState } from "react";
import { CYPHER, Q } from "../kg.js";
import { Callout, Cypher, NodeLink, Table, fmtTime, href, setParam } from "../ui.jsx";

export default function Maintenance({ kg, params }) {
  const models = useMemo(() => Q.models(kg), [kg]);
  const [model, setModel] = useState(models.includes(params.model) ? params.model : "TX-200");
  useEffect(() => { if (params.model && models.includes(params.model)) setModel(params.model); }, [params.model, models]);
  const choose = (v) => { setModel(v); setParam("maint", params, "model", v); };

  const inst = Q.installsForModel(kg, model);
  const rec = Q.recommendation(kg, model);
  const wos = Q.workOrders(kg);

  return (
    <>
      <div className="page-head">
        <h2>Maintenance knowledge</h2>
        <p>The graph separates the position (Control Module) from the hardware (Physical Device). That makes it possible to ask
          where a device model is installed and what its history is across the plant.</p>
      </div>
      <div className="stack">
        <div className="row">
          <div className="field">
            <label htmlFor="model">Device model</label>
            <select id="model" value={model} onChange={(e) => choose(e.target.value)}>
              {models.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {rec.drifts >= 2 && rec.still.length > 0 ? (
          <Callout tone="warning">
            <b>Recommendation:</b> model {model} has {rec.drifts} drift findings ({rec.where.join(", ")}).
            It is still installed at {rec.still.join(", ")}. Schedule a calibration check before the next batch on that unit.
          </Callout>
        ) : (
          <Callout tone="good">No repeated drift findings for model {model}.</Callout>
        )}

        <div className="card">
          <h3>Where model {model} is or was installed, with its maintenance history</h3>
          <p className="hint">Work orders are matched to the device that was installed at the position when the work order was created.</p>
          <Table rows={inst} columns={[
            { key: "serial", render: (r) => <NodeLink nodeKey={`PhysicalDevice:${r.serial}`} /> },
            { key: "position", render: (r) => <a className="link" href={href("fault", { cm: r.position })}>{r.position}</a> },
            { key: "unit" },
            { key: "installed", render: (r) => fmtTime(r.installed) },
            { key: "removed", render: (r) => (r.removed ? fmtTime(r.removed) : <em style={{ color: "var(--good-ink)" }}>still installed</em>) },
            { key: "work_order", label: "work order", render: (r) => r.work_order && <NodeLink nodeKey={`WorkOrder:${r.work_order}`} /> },
            { key: "code" },
            { key: "finding" },
          ]} />
          <Cypher query={CYPHER.installs} />
          <Cypher query={CYPHER.recommendation} title="Cypher: recommendation rule" />
        </div>

        <div className="card">
          <h3>All work orders (CMMS export)</h3>
          <p className="hint">Each work order is linked to the Control Module it was carried out on, and to the alarm and devices where known.</p>
          <Table rows={wos} columns={[
            { key: "id", label: "work order", render: (r) => <NodeLink nodeKey={`WorkOrder:${r.id}`} /> },
            { key: "on", label: "on", render: (r) => <NodeLink nodeKey={`Equipment:${r.on}`} /> },
            { key: "created", render: (r) => fmtTime(r.created) },
            { key: "code", label: "failure code" },
            { key: "description" },
            { key: "removed", label: "removed device" },
            { key: "installed", label: "installed device" },
          ]} />
        </div>
      </div>
    </>
  );
}
