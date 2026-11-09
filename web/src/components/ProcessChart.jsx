import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cssVar, fmtClock, niceAxis, useTheme } from "../ui.jsx";

// One tag's raw values over a batch, with the phase runs as bands and the tag's alarm limits.
export default function ProcessChart({ tag, points, bands, t0, t1 }) {
  useTheme(); // re-read colours on theme change
  const c = { grid: cssVar("--grid"), axis: cssVar("--axis"), muted: cssVar("--muted"), line: cssVar("--s1"),
    band: cssVar("--surface-2"), warn: cssVar("--warning"), crit: cssVar("--critical"), ink2: cssVar("--ink-2") };
  const limits = [
    tag.limitLo != null && { y: tag.limitLo, label: `LO ${tag.limitLo}`, color: c.warn },
    tag.limitHi != null && { y: tag.limitHi, label: `HI ${tag.limitHi}`, color: c.warn },
    tag.limitHiHi != null && { y: tag.limitHiHi, label: `HIHI ${tag.limitHiHi}`, color: c.crit },
  ].filter(Boolean);
  const values = points.map((p) => p.v);
  const lo = Math.min(...values, ...limits.map((l) => l.y));
  const hi = Math.max(...values, ...limits.map((l) => l.y));
  const axis = niceAxis(lo, hi);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{tag.id} <span style={{ color: "var(--muted)", fontWeight: 400 }}>· {tag.description} [{tag.engUnit}]</span></strong>
        {limits.length > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Limits from the Tag node: {limits.map((l) => l.label).join(", ")}</span>}
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={points} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          {bands.map((b, i) => (
            <ReferenceArea key={b.phase} x1={b.start} x2={b.end} fill={i % 2 ? c.band : "transparent"} fillOpacity={1} ifOverflow="hidden"
              label={{ value: b.phase, position: "insideTop", fontSize: 10, fill: c.muted, dy: -16 }} />
          ))}
          {limits.map((l) => (
            <ReferenceLine key={l.label} y={l.y} stroke={l.color} strokeDasharray="4 4" strokeWidth={1.5}
              label={{ value: l.label, position: l.label.startsWith("HIHI") ? "insideTopRight" : "insideBottomRight", fontSize: 10, fill: c.ink2 }} />
          ))}
          <XAxis dataKey="t" type="number" scale="time" domain={[t0, t1]} tickFormatter={fmtClock} stroke={c.axis}
            tick={{ fontSize: 11, fill: c.muted }} tickLine={false} minTickGap={40} />
          <YAxis domain={axis.domain} ticks={axis.ticks} stroke={c.axis} tick={{ fontSize: 11, fill: c.muted }}
            tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ stroke: c.axis }} content={({ active, payload }) => active && payload?.length ? (
            <div className="chart-tip">
              <div className="t">{fmtClock(payload[0].payload.t)} UTC · {bands.find((b) => payload[0].payload.t >= b.start && payload[0].payload.t <= b.end)?.phase ?? ""}</div>
              <div><b>{payload[0].value}</b> {tag.engUnit}</div>
            </div>
          ) : null} />
          <Line dataKey="v" stroke={c.line} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
