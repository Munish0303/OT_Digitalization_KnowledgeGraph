// In-browser knowledge graph. graph.json is an export of the same nodes, labels,
// relationship types and properties that kg-sync writes to Neo4j. Every analytics
// view below is a traversal over this graph; the matching Cypher is shown next to it.

const ms = (iso) => (iso ? Date.parse(iso) : null);

export class KG {
  constructor({ nodes, relationships }) {
    this.nodes = new Map(nodes.map((n) => [n.key, n]));
    this.rels = relationships;
    this._out = new Map();
    this._in = new Map();
    for (const r of relationships) {
      push(this._out, r.start, r);
      push(this._in, r.end, r);
    }
  }
  get(key) { return this.nodes.get(key); }
  has(label, n) { return n.labels.includes(label); }
  byLabel(label) { return [...this.nodes.values()].filter((n) => n.labels.includes(label)); }
  out(key, type) {
    return (this._out.get(key) || []).filter((r) => !type || r.type === type).map((rel) => ({ rel, node: this.nodes.get(rel.end) }));
  }
  inc(key, type) {
    return (this._in.get(key) || []).filter((r) => !type || r.type === type).map((rel) => ({ rel, node: this.nodes.get(rel.start) }));
  }
  degree(key) { return (this._out.get(key) || []).length + (this._in.get(key) || []).length; }
}

function push(map, k, v) {
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(v);
}

export async function loadGraph() {
  const [graph, meta] = await Promise.all([
    fetch("/data/graph.json").then((r) => r.json()),
    fetch("/data/meta.json").then((r) => r.json()),
  ]);
  return { kg: new KG(graph), meta };
}

const pvCache = new Map();
export function loadProcessValues(batchId) {
  if (!pvCache.has(batchId)) pvCache.set(batchId, fetch(`/data/pv/${batchId}.json`).then((r) => r.json()));
  return pvCache.get(batchId);
}

// Display name for a node, the way the Neo4j Browser caption would show it.
export function caption(n) {
  const p = n.props;
  if (n.labels.includes("Alarm")) return `${p.level} ${p.tagId.split(".")[0]}`;
  if (n.labels.includes("PhaseRun")) return `${p.id.split(".")[0]} ${p.name}`;
  if (n.labels.includes("Phase")) return p.name;
  if (n.labels.includes("Operation") || n.labels.includes("UnitProcedure")) return p.name;
  if (n.labels.includes("MasterRecipe")) return `${p.name} v${p.version}`;
  if (n.labels.includes("PhysicalDevice")) return p.serial;
  if (n.labels.includes("Material")) return p.name || p.id;
  return p.id ?? p.serial ?? n.key;
}

// Most specific label (Equipment nodes also carry their ISA-88 level).
export function kind(n) {
  return n.labels.length > 1 && n.labels[0] === "Equipment" ? n.labels[1] : n.labels[0];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const Q = {
  batches(kg) {
    return kg.byLabel("Batch").map((b) => b.props.id).sort().reverse();
  },

  batchHeader(kg, id) {
    const b = kg.get(`Batch:${id}`);
    if (!b) return null;
    const mr = kg.out(b.key, "FOLLOWS")[0]?.node;
    return { recipe: mr ? `${mr.props.name} v${mr.props.version}` : "", recipeId: mr?.props.id, ...b.props };
  },

  upstream(kg, id) {
    return kg.out(`Batch:${id}`, "CONSUMED").map(({ rel, node: l }) => ({
      lot: l.props.id,
      material: kg.out(l.key, "OF_MATERIAL")[0]?.node.props.name,
      qty_kg: rel.props.qtyKg,
      produced_by: kg.inc(l.key, "PRODUCED")[0]?.node.props.id ?? null,
    })).sort(by("lot"));
  },

  downstream(kg, id) {
    const rows = [];
    for (const { node: l } of kg.out(`Batch:${id}`, "PRODUCED")) {
      const users = kg.inc(l.key, "CONSUMED");
      if (!users.length) rows.push({ produced_lot: l.props.id, used_in_batch: null, qty_kg: null, resulting_lot: null });
      for (const { rel, node: d } of users) {
        for (const { node: l2 } of kg.out(d.key, "PRODUCED")) {
          rows.push({ produced_lot: l.props.id, used_in_batch: d.props.id, qty_kg: rel.props.qtyKg, resulting_lot: l2.props.id });
        }
      }
    }
    return rows.sort(by("used_in_batch"));
  },

  // Transitive genealogy in one direction (quantified path pattern in Cypher).
  genealogy(kg, id, direction) {
    const seen = new Set([`Batch:${id}`]);
    const edges = [];
    let frontier = [`Batch:${id}`];
    for (let depth = 0; depth < 6 && frontier.length; depth++) {
      const next = [];
      for (const bk of frontier) {
        const lots = direction === "down" ? kg.out(bk, "PRODUCED") : kg.out(bk, "CONSUMED");
        for (const { node: l } of lots) {
          const batches = direction === "down" ? kg.inc(l.key, "CONSUMED") : kg.inc(l.key, "PRODUCED");
          edges.push({ from: bk, lot: l.key, to: batches.map((x) => x.node.key) });
          for (const { node: b } of batches) if (!seen.has(b.key)) { seen.add(b.key); next.push(b.key); }
        }
      }
      frontier = next;
    }
    return edges;
  },

  phaseRuns(kg, id) {
    const tt = "Tag:TT101.PV";
    return kg.out(`Batch:${id}`, "HAS_PHASE_RUN").map(({ node: pr }) => {
      const ph = kg.out(pr.key, "INSTANCE_OF")[0]?.node;
      const em = kg.out(pr.key, "EXECUTED_ON")[0]?.node;
      const m = kg.out(pr.key, "MEASURED").find((x) => x.node.key === tt)?.rel;
      return {
        id: pr.props.id,
        phase: pr.props.name,
        type: ph?.props.type,
        equipment_module: em?.props.id,
        start: pr.props.start,
        end: pr.props.end,
        sp_temp: ph?.props.sp_temperature_c ?? null,
        max_tt101: m?.props.max ?? null,
        actuals: Object.fromEntries(Object.entries(pr.props).filter(([k]) => k.startsWith("actual_")).map(([k, v]) => [k.slice(7), v])),
        setpoints: Object.fromEntries(Object.entries(ph?.props || {}).filter(([k]) => k.startsWith("sp_")).map(([k, v]) => [k.slice(3), v])),
        alarms: kg.inc(pr.key, "DURING").map(({ node: a }) => ({ severity: a.props.severity, message: a.props.message })),
      };
    }).sort((a, b) => ms(a.start) - ms(b.start));
  },

  batchTags(kg, id) {
    const tags = new Map();
    for (const { node: pr } of kg.out(`Batch:${id}`, "HAS_PHASE_RUN"))
      for (const { node: em } of kg.out(pr.key, "EXECUTED_ON"))
        for (const { node: cm } of kg.out(em.key, "CONTAINS"))
          for (const { node: t } of kg.out(cm.key, "HAS_TAG")) tags.set(t.props.id, t.props);
    return [...tags.values()].sort(by("id"));
  },

  controlModulesWithTags(kg) {
    return kg.byLabel("ControlModule").filter((cm) => kg.out(cm.key, "HAS_TAG").length).map((cm) => cm.props.id).sort();
  },

  deviceAt(kg, cmKey, t) {
    const hit = kg.inc(cmKey, "INSTALLED_AT").find(({ rel }) => ms(rel.props.from) <= t && (rel.props.to == null || t < ms(rel.props.to)));
    return hit?.node.props ?? null;
  },

  alarmHistory(kg, cm) {
    const cmKey = `Equipment:${cm}`;
    return kg.inc(cmKey, "RAISED_BY").map(({ node: a }) => {
      const pr = kg.out(a.key, "DURING")[0]?.node;
      const b = pr ? kg.inc(pr.key, "HAS_PHASE_RUN")[0]?.node : null;
      const d = Q.deviceAt(kg, cmKey, ms(a.props.time));
      const w = kg.inc(a.key, "TRIGGERED_BY")[0]?.node;
      return {
        time: a.props.time, batch: b?.props.id ?? null, phase: pr?.props.name ?? null,
        severity: a.props.severity, level: a.props.level, value: a.props.value,
        device: d?.serial ?? null, model: d?.model ?? null,
        work_order: w?.props.id ?? null, failure_code: w?.props.failureCode ?? null,
      };
    }).sort((x, y) => ms(x.time) - ms(y.time));
  },

  trend(kg, cm) {
    const cmKey = `Equipment:${cm}`;
    const rows = [];
    for (const { node: t } of kg.out(cmKey, "HAS_TAG"))
      for (const { rel: m, node: pr } of kg.inc(t.key, "MEASURED")) {
        const b = kg.inc(pr.key, "HAS_PHASE_RUN")[0]?.node;
        const d = Q.deviceAt(kg, cmKey, ms(pr.props.start));
        rows.push({ batch: b.props.id, phase: pr.props.name, tag: t.props.id, max: m.props.max, avg: m.props.avg,
          min: m.props.min, samples: m.props.samples, device: d?.serial ?? "unknown", model: d?.model ?? "" });
      }
    return rows.sort(by("batch"));
  },

  models(kg) {
    return [...new Set(kg.byLabel("PhysicalDevice").map((d) => d.props.model))].sort();
  },

  installsForModel(kg, model) {
    const rows = [];
    for (const d of kg.byLabel("PhysicalDevice").filter((d) => d.props.model === model))
      for (const { rel: i, node: cm } of kg.out(d.key, "INSTALLED_AT")) {
        const em = kg.inc(cm.key, "CONTAINS")[0]?.node;
        const unit = em ? kg.inc(em.key, "CONTAINS")[0]?.node : null;
        const wos = kg.inc(cm.key, "ON").map((x) => x.node)
          .filter((w) => ms(w.props.created) >= ms(i.props.from) && (i.props.to == null || ms(w.props.created) <= ms(i.props.to)));
        const base = { serial: d.props.serial, position: cm.props.id, unit: unit?.props.id, installed: i.props.from, removed: i.props.to };
        if (!wos.length) rows.push({ ...base, work_order: null, code: null, finding: null });
        for (const w of wos) rows.push({ ...base, work_order: w.props.id, code: w.props.failureCode, finding: w.props.description });
      }
    return rows.sort((a, b) => cmp(a.position, b.position) || cmp(a.installed, b.installed) || cmp(a.work_order, b.work_order));
  },

  recommendation(kg, model) {
    const rows = Q.installsForModel(kg, model);
    const drifts = rows.filter((r) => r.code === "DRIFT");
    const still = [...new Set(rows.filter((r) => r.removed == null).map((r) => `${r.position} (${r.serial})`))];
    return { drifts: new Set(drifts.map((r) => r.work_order)).size, where: [...new Set(drifts.map((r) => r.position))], still };
  },

  workOrders(kg) {
    return kg.byLabel("WorkOrder").map((w) => ({
      id: w.props.id, on: kg.out(w.key, "ON")[0]?.node.props.id, created: w.props.created, code: w.props.failureCode,
      description: w.props.description, alarm: kg.out(w.key, "TRIGGERED_BY")[0]?.node.props.id ?? null,
      removed: kg.out(w.key, "REMOVED")[0]?.node.props.serial ?? null,
      installed: kg.out(w.key, "INSTALLED")[0]?.node.props.serial ?? null,
    })).sort(by("created"));
  },

  labelCounts(kg) {
    const c = new Map();
    for (const n of kg.nodes.values()) for (const l of n.labels) c.set(l, (c.get(l) || 0) + 1);
    return [...c].map(([label, nodes]) => ({ label, nodes })).sort((a, b) => b.nodes - a.nodes);
  },

  relCounts(kg) {
    const c = new Map();
    for (const r of kg.rels) c.set(r.type, (c.get(r.type) || 0) + 1);
    return [...c].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  },

  // Meta-graph: which label connects to which via which relationship type.
  schema(kg) {
    const c = new Map();
    for (const r of kg.rels) {
      const k = `${kind(kg.get(r.start))}|${r.type}|${kind(kg.get(r.end))}`;
      c.set(k, (c.get(k) || 0) + 1);
    }
    return [...c].map(([k, count]) => { const [from, type, to] = k.split("|"); return { from, type, to, count }; });
  },
};

function cmp(a, b) { return a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0; }
function by(k) { return (a, b) => cmp(a[k], b[k]); }

// Cypher equivalents (as run against Neo4j in the Docker stack).
export const CYPHER = {
  header: `MATCH (b:Batch {id: $id})-[:FOLLOWS]->(mr:MasterRecipe)
RETURN mr.name + ' v' + mr.version AS recipe, b.status, b.start, b.end`,
  upstream: `MATCH (b:Batch {id: $id})-[c:CONSUMED]->(l:MaterialLot)-[:OF_MATERIAL]->(m:Material)
OPTIONAL MATCH (src:Batch)-[:PRODUCED]->(l)
RETURN l.id AS lot, m.name AS material, c.qtyKg AS qty_kg, src.id AS produced_by
ORDER BY lot`,
  downstream: `MATCH (b:Batch {id: $id})-[:PRODUCED]->(l:MaterialLot)
OPTIONAL MATCH (l)<-[c:CONSUMED]-(d:Batch)-[:PRODUCED]->(l2:MaterialLot)
RETURN l.id AS produced_lot, d.id AS used_in_batch, c.qtyKg AS qty_kg, l2.id AS resulting_lot`,
  genealogy: `// forward: every lot that (transitively) contains material of the batch
MATCH (b:Batch {id: $id})-[:PRODUCED]->(l0:MaterialLot)
MATCH path = (l0) ((:MaterialLot)<-[:CONSUMED]-(:Batch)-[:PRODUCED]->(:MaterialLot)){0,5}
RETURN [n IN nodes(path) | n.id] AS genealogy`,
  phaseRuns: `MATCH (b:Batch {id: $id})-[:HAS_PHASE_RUN]->(pr:PhaseRun)-[:EXECUTED_ON]->(em:EquipmentModule),
      (pr)-[:INSTANCE_OF]->(ph:Phase)
OPTIONAL MATCH (a:Alarm)-[:DURING]->(pr)
OPTIONAL MATCH (pr)-[m:MEASURED]->(:Tag {id: 'TT101.PV'})
RETURN pr.name AS phase, em.id AS equipment_module, pr.start, pr.end,
       ph.sp_temperature_c AS sp_temp, m.max AS max_tt101,
       collect(a.severity + ': ' + a.message) AS alarms
ORDER BY pr.start`,
  tags: `// the graph tells us which tags to fetch; values come from the time-series store
MATCH (b:Batch {id: $id})-[:HAS_PHASE_RUN]->(:PhaseRun)-[:EXECUTED_ON]->(:EquipmentModule)
      -[:CONTAINS]->(:ControlModule)-[:HAS_TAG]->(t:Tag)
RETURN DISTINCT t.id, t.engUnit, t.timeSeriesStore`,
  alarms: `MATCH (a:Alarm)-[:RAISED_BY]->(cm:ControlModule {id: $cm})
OPTIONAL MATCH (a)-[:DURING]->(pr:PhaseRun)<-[:HAS_PHASE_RUN]-(b:Batch)
OPTIONAL MATCH (d:PhysicalDevice)-[i:INSTALLED_AT]->(cm)
  WHERE i.from <= a.time AND (i.to IS NULL OR a.time < i.to)
OPTIONAL MATCH (w:WorkOrder)-[:TRIGGERED_BY]->(a)
RETURN a.time, b.id AS batch, pr.name AS phase, a.severity, a.value,
       d.serial AS device, d.model, w.id AS work_order, w.failureCode
ORDER BY a.time`,
  trend: `MATCH (cm:ControlModule {id: $cm})-[:HAS_TAG]->(t:Tag)
MATCH (b:Batch)-[:HAS_PHASE_RUN]->(pr:PhaseRun)-[m:MEASURED]->(t)
WHERE b.id <= 'B-0420'
OPTIONAL MATCH (d:PhysicalDevice)-[i:INSTALLED_AT]->(cm)
  WHERE i.from <= pr.start AND (i.to IS NULL OR pr.start < i.to)
RETURN b.id AS batch, pr.name AS phase, m.max, m.avg, d.serial AS device
ORDER BY batch`,
  installs: `MATCH (d:PhysicalDevice {model: $m})-[i:INSTALLED_AT]->(cm:ControlModule)
      <-[:CONTAINS]-(:EquipmentModule)<-[:CONTAINS]-(u:Unit)
OPTIONAL MATCH (w:WorkOrder)-[:ON]->(cm)
  WHERE w.created >= i.from AND (i.to IS NULL OR w.created <= i.to)
RETURN d.serial, cm.id AS position, u.id AS unit, i.from AS installed, i.to AS removed,
       w.id AS work_order, w.failureCode AS code, w.description AS finding`,
  recommendation: `MATCH (:PhysicalDevice {model: $m})-[i:INSTALLED_AT]->(cm:ControlModule)
      <-[:ON]-(w:WorkOrder {failureCode: 'DRIFT'})
WHERE w.created >= i.from AND (i.to IS NULL OR w.created <= i.to)
WITH count(DISTINCT w) AS drifts, collect(DISTINCT cm.id) AS where
MATCH (d:PhysicalDevice {model: $m})-[i:INSTALLED_AT]->(cm:ControlModule)
WHERE i.to IS NULL
RETURN drifts, where, collect(cm.id + ' (' + d.serial + ')') AS still_installed`,
  labels: `MATCH (n) UNWIND labels(n) AS label
RETURN label, count(*) AS nodes ORDER BY nodes DESC`,
  schema: `CALL db.schema.visualization()`,
};
