import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CYPHER, Q } from "../kg.js";
import { Callout, Cypher, NodeLink, Table, cssVar, fmtTime, href, niceAxis, setParam, useTheme } from "../ui.jsx";

const SERIES = ["--s1", "--s2", "--s3", "--s4"];

export default function FaultAnalysis({ kg, params }) {
  useTheme();
  const cms = useMemo(() => Q.controlModulesWithTags(kg), [kg]);
  const [cm, setCm] = useState(cms.includes(params.cm) ? params.cm : "TT101");
  useEffect(() => { if (params.cm && cms.includes(params.cm)) setCm(params.cm); }, [params.cm, cms]);

  const alarms = Q.alarmHistory(kg, cm);
  const trend = Q.trend(kg, cm);
  const phases = [...new Set(trend.map((t) => t.phase))].sort();
  const [phase, setPhase] = useState(null);
  const ph = phases.includes(phase) ? phase : phases.includes("Hold") ? "Hold" : phases[0];
  const tagNodes = kg.out(`Equipment:${cm}`, "HAS_TAG").map((x) => x.node.props);
  const tag = tagNodes[0];
  const rows = trend.filter((t) => t.phase === ph);
  const devices = [...new Set(trend.map((t) => t.device))];
  const color = (d) => cssVar(SERIES[devices.indexOf(d) % SERIES.length]);
  const wos = Q.workOrders(kg).filter((w) => w.on === cm);

  const choose = (v) => { setCm(v); setPhase(null); setParam("fault", params, "cm", v); };

  const c = { grid: cssVar("--grid"), axis: cssVar("--axis"), muted: cssVar("--muted"), warn: cssVar("--warning"), crit: cssVar("--critical"), ink2: cssVar("--ink-2") };
  const vals = rows.map((r) => r.max);
  const limits = [tag?.limitHi != null && { y: tag.limitHi, l: `HI ${tag.limitHi}`, color: c.warn },
    tag?.limitHiHi != null && { y: tag.limitHiHi, l: `HIHI ${tag.limitHiHi}`, color: c.crit }].filter(Boolean);
  const showLimits = limits.filter((l) => l.y <= Math.max(...vals) * 1.15);
  const lo = Math.min(...vals), hi = Math.max(...vals, ...showLimits.map((l) => l.y));
  // Peaks cluster far from zero; a zoomed axis shows the drift. The axis floor is labelled, bars start there.
  const axis = niceAxis(lo > 0 && lo > (hi - lo) * 2 ? lo - (hi - lo) * 0.3 : 0, hi);

  return (
    <>
      <div className="page-head">
        <h2>Fault analysis</h2>
        <p>Alarm history of one Control Module across all batches, with the physical device that was installed at the time
          and the work orders it triggered. Per-batch aggregates are stored on the graph, so the trend needs no raw data.</p>
      </div>
      <div className="stack">
        <div className="row">
          <div className="field">
            <label htmlFor="cm">Control Module</label>
            <select id="cm" value={cm} onChange={(e) => choose(e.target.value)}>
              {cms.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <NodeLink nodeKey={`Equipment:${cm}`}>Show {cm} in the knowledge graph →</NodeLink>
        </div>

        <div className="card">
          <h3>Alarm history of {cm} across batches</h3>
          <p className="hint">Alarm → Phase Run → Batch, plus the Physical Device installed at the alarm time (INSTALLED_AT is time-bounded).</p>
          <Table rows={alarms} empty="No alarms recorded for this Control Module." columns={[
            { key: "time", label: "time (UTC)", render: (r) => fmtTime(r.time) },
            { key: "batch", render: (r) => r.batch && <a className="link" href={href("trace", { batch: r.batch })}>{r.batch}</a> },
            { key: "phase" },
            { key: "severity", render: (r) => <span className={`sev ${r.severity}`}>{r.severity} · {r.level}</span> },
            { key: "value", num: true },
            { key: "device", render: (r) => r.device && <NodeLink nodeKey={`PhysicalDevice:${r.device}`} /> },
            { key: "model" },
            { key: "work_order", label: "work order", render: (r) => r.work_order && <NodeLink nodeKey={`WorkOrder:${r.work_order}`} /> },
            { key: "failure_code", label: "failure code" },
          ]} />
          <Cypher query={CYPHER.alarms} />
        </div>

        {trend.length > 0 && (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <h3>Peak {tag?.id} per batch{ph ? ` · ${ph} phase` : ""}</h3>
                <p className="hint" style={{ marginBottom: 0 }}>Max value in the phase, from the MEASURED aggregate on each Phase Run. Colour = device installed at the time.</p>
              </div>
              {phases.length > 1 && (
                <div className="field" style={{ minWidth: 140 }}>
                  <label htmlFor="phase">Phase</label>
                  <select id="phase" value={ph} onChange={(e) => setPhase(e.target.value)}>
                    {phases.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="legend" style={{ margin: "12px 0 4px" }}>
              {devices.map((d) => {
                const m = trend.find((t) => t.device === d)?.model;
                return <span key={d}><i style={{ background: color(d) }} />{d}{m ? ` (${m})` : ""}</span>;
              })}
              {showLimits.map((l) => <span key={l.l}><i style={{ background: "none", borderTop: `2px dashed ${l.color}`, height: 0, borderRadius: 0 }} />{l.l} limit</span>)}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={2}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="batch" stroke={c.axis} tick={{ fontSize: 11, fill: c.muted }} tickLine={false} interval={0}
                  angle={rows.length > 12 ? -45 : 0} textAnchor={rows.length > 12 ? "end" : "middle"} height={rows.length > 12 ? 52 : 28} />
                <YAxis domain={axis.domain} ticks={axis.ticks} stroke={c.axis} tick={{ fontSize: 11, fill: c.muted }} tickLine={false} axisLine={false} width={44}
                  allowDataOverflow />
                <Tooltip cursor={{ fill: cssVar("--surface-2") }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="chart-tip">
                    <div className="t">{payload[0].payload.batch} · {payload[0].payload.phase}</div>
                    <div>max <b>{payload[0].payload.max}</b> {tag?.engUnit} · avg {payload[0].payload.avg}</div>
                    <div style={{ color: "var(--muted)" }}>{payload[0].payload.device} ({payload[0].payload.model}) · {payload[0].payload.samples} samples</div>
                  </div>
                ) : null} />
                {showLimits.map((l) => <ReferenceLine key={l.l} y={l.y} stroke={l.color} strokeDasharray="4 4" strokeWidth={1.5}
                  label={{ value: l.l, position: "insideTopRight", fontSize: 10, fill: c.ink2 }} />)}
                <Bar dataKey="max" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}
                  onClick={(d) => { window.location.hash = href("trace", { batch: d.batch }); }} style={{ cursor: "pointer" }}>
                  {rows.map((r) => <Cell key={r.batch} fill={color(r.device)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {cm === "TT101" && ph === "Hold" && (
              <Callout tone="info">
                The peaks rise batch after batch on the old transmitter (SN-TT-48211) and disappear after the replacement.
                The HI warnings in <a className="link" href={href("trace", { batch: "B-0400" })}>B-0400</a> and{" "}
                <a className="link" href={href("trace", { batch: "B-0406" })}>B-0406</a> were early signals; WO-76890 found "no fault".
              </Callout>
            )}
            <Cypher query={CYPHER.trend} />
          </div>
        )}

        <div className="card">
          <h3>Work orders on {cm}</h3>
          <p className="hint">From the CMMS export (simulated SAP PM), linked to the alarm that triggered them.</p>
          <Table rows={wos} empty="No work orders on this Control Module." columns={[
            { key: "id", label: "work order", render: (r) => <NodeLink nodeKey={`WorkOrder:${r.id}`} /> },
            { key: "created", render: (r) => fmtTime(r.created) },
            { key: "code", label: "failure code" },
            { key: "description" },
            { key: "alarm", label: "triggered by", render: (r) => r.alarm && <span className="mono">{r.alarm}</span> },
          ]} />
        </div>
      </div>
    </>
  );
}
