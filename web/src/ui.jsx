import { useEffect, useState, useSyncExternalStore } from "react";

// --- node domains: one colour + one shape per domain (identity never colour-only) ---
export const DOMAINS = [
  { id: "physical", name: "Physical model", color: "--s1", shape: "round-rectangle",
    labels: ["Enterprise", "Site", "Area", "ProcessCell", "Unit", "EquipmentModule", "ControlModule"] },
  { id: "tag", name: "Tags", color: "--s3", shape: "tag", labels: ["Tag"] },
  { id: "procedural", name: "Procedural model", color: "--s7", shape: "diamond",
    labels: ["MasterRecipe", "UnitProcedure", "Operation", "Phase"] },
  { id: "execution", name: "Batches & phase runs", color: "--s2", shape: "ellipse", labels: ["Batch", "PhaseRun"] },
  { id: "material", name: "Materials & lots", color: "--s6", shape: "hexagon", labels: ["Material", "MaterialLot"] },
  { id: "maintenance", name: "Devices & work orders", color: "--s5", shape: "barrel", labels: ["PhysicalDevice", "WorkOrder"] },
  { id: "alarm", name: "Alarms", color: "--s8", shape: "triangle", labels: ["Alarm"] },
];
const DOMAIN_OF = Object.fromEntries(DOMAINS.flatMap((d) => d.labels.map((l) => [l, d])));
export const domainOf = (label) => DOMAIN_OF[label] || DOMAINS[0];
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// --- theme ------------------------------------------------------------------
const themeListeners = new Set();
function readTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("kg-theme", t); } catch { /* storage unavailable */ }
  themeListeners.forEach((f) => f());
}
try {
  const saved = localStorage.getItem("kg-theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch { /* storage unavailable */ }
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => themeListeners.forEach((f) => f()));
export function useTheme() {
  return useSyncExternalStore((f) => { themeListeners.add(f); return () => themeListeners.delete(f); }, readTheme);
}

// --- hash routing: #/trace?batch=B-0412 --------------------------------------
function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  return { path: path || "story", params: Object.fromEntries(new URLSearchParams(qs || "")) };
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const f = () => setRoute(parseHash());
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return route;
}
export function href(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== "")).toString();
  return `#/${path}${qs ? `?${qs}` : ""}`;
}
export function go(path, params) {
  window.location.hash = href(path, params);
}
// Keep a view's selection in the URL so links are shareable.
export function setParam(path, params, key, value) {
  window.history.replaceState(null, "", href(path, { ...params, [key]: value }));
}

// --- formatting ----------------------------------------------------------------
export function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}
export function fmtClock(msOrIso) {
  return new Date(msOrIso).toISOString().slice(11, 16);
}

// --- components ------------------------------------------------------------------
export function Cypher({ query, title = "Cypher equivalent" }) {
  return (
    <details className="cypher">
      <summary>{title}</summary>
      <pre>{query}</pre>
    </details>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function Callout({ tone = "info", icon, children }) {
  const glyph = icon ?? { critical: "!", warning: "!", info: "i", good: "✓" }[tone];
  return (
    <div className={`callout ${tone}`} role={tone === "critical" ? "alert" : undefined}>
      <span className="icon" aria-hidden="true">{glyph}</span>
      <div>{children}</div>
    </div>
  );
}

// columns: [{key, label, num?, render?(row)}]
export function Table({ columns, rows, empty = "No rows." }) {
  if (!rows.length) return <p className="hint">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key}>{c.label ?? c.key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = c.render ? c.render(r) : r[c.key];
                return (
                  <td key={c.key} className={c.num ? "num" : undefined}>
                    {v == null || v === "" ? <span className="null">–</span> : v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Link to a node in the graph explorer. nodeKey = "<Label>:<id>", equipment uses "Equipment:<id>".
export function NodeLink({ nodeKey, children }) {
  return (
    <a className="link" href={href("graph", { focus: nodeKey })} title="Show in knowledge graph">
      {children ?? nodeKey.split(":").slice(1).join(":")}
    </a>
  );
}

// Round axis bounds to a readable step (1, 2, 5 x 10^n) and return explicit ticks.
export function niceAxis(lo, hi, count = 5) {
  if (!isFinite(lo) || !isFinite(hi)) return { domain: [0, 1], ticks: [0, 1] };
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { domain: [a, b], ticks };
}
