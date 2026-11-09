// =====================================================================
// Golden story – demo queries for Neo4j Browser (http://localhost:7474)
// login: neo4j / knowledge-graph
// Simulated data. Story: TT101 transmitter degrades -> B-0412 HIHI alarm.
// Queries over many batches are limited to the 30 historical ones (b.id <= 'B-0420'),
// so live batches added while showing Litmus Edge don't change the results.
// =====================================================================

// --- 0. The ISA-88 Physical Model as a graph ---------------------------
MATCH p = (:Enterprise)-[:CONTAINS*]->(:ControlModule)
RETURN p;

// Everything below Unit R-101, at any depth (works even if a level is added later)
MATCH (:Unit {id: 'R101'})-[:CONTAINS*]->(e:Equipment)
RETURN e.id, labels(e), e.name;

// --- 1. Procedural Model linked to the Physical Model ------------------
MATCH p = (:MasterRecipe {id: 'MR-CB'})-[:HAS_UNIT_PROCEDURE|HAS_OPERATION|HAS_PHASE|RUNS_ON*]->()
RETURN p;

// --- 2. USE CASE: batch traceability for B-0412 ------------------------
// One picture: recipe, phase runs, equipment, alarms, lots in and out
MATCH (b:Batch {id: 'B-0412'})
OPTIONAL MATCH p1 = (b)-[:FOLLOWS]->(:MasterRecipe)
OPTIONAL MATCH p2 = (b)-[:HAS_PHASE_RUN]->(:PhaseRun)-[:EXECUTED_ON]->(:EquipmentModule)
OPTIONAL MATCH p3 = (:Alarm)-[:DURING]->(:PhaseRun)<-[:HAS_PHASE_RUN]-(b)
OPTIONAL MATCH p4 = (b)-[:CONSUMED|PRODUCED]->(:MaterialLot)
RETURN p1, p2, p3, p4;

// Forward genealogy: every lot that (transitively) contains material of B-0412
// (quantified path pattern, Neo4j 5.9+)
MATCH (b:Batch {id: 'B-0412'})-[:PRODUCED]->(l0:MaterialLot)
MATCH path = (l0) ((:MaterialLot)<-[:CONSUMED]-(:Batch)-[:PRODUCED]->(:MaterialLot)){0,5}
RETURN [n IN nodes(path) | coalesce(n.id, '')] AS genealogy;

// Upstream genealogy: every lot that (transitively) went INTO B-0412
MATCH (b:Batch {id: 'B-0412'})-[:CONSUMED]->(l0:MaterialLot)
MATCH path = (l0) ((:MaterialLot)<-[:PRODUCED]-(:Batch)-[:CONSUMED]->(:MaterialLot)){0,5}
RETURN [n IN nodes(path) | coalesce(n.id, '')] AS genealogy;

// Recall impact (downstream from a raw-material lot): if RL-LIM-2601 is recalled, which batches and lots are affected?
MATCH (:MaterialLot {id: 'RL-LIM-2601'})<-[:CONSUMED]-(b:Batch)-[:PRODUCED]->(l:MaterialLot)
WHERE b.id <= 'B-0420'
OPTIONAL MATCH (l)<-[:CONSUMED]-(b2:Batch)-[:PRODUCED]->(l2:MaterialLot)
WHERE b2.id <= 'B-0420'
RETURN b.id, l.id, collect(DISTINCT b2.id) AS downstream_batches, collect(DISTINCT l2.id) AS downstream_lots;

// --- 3. USE CASE: fault analysis ---------------------------------------
// All alarms of TT101: in which batch, which phase, on which physical device?
MATCH (a:Alarm)-[:RAISED_BY]->(cm:ControlModule {id: 'TT101'})
MATCH (a)-[:DURING]->(pr:PhaseRun)<-[:HAS_PHASE_RUN]-(b:Batch)
WHERE b.id <= 'B-0420'
MATCH (d:PhysicalDevice)-[i:INSTALLED_AT]->(cm)
WHERE i.from <= a.time AND (i.to IS NULL OR a.time < i.to)
OPTIONAL MATCH (w:WorkOrder)-[:TRIGGERED_BY]->(a)
RETURN a.time, b.id, pr.name, a.severity, a.value, d.serial, d.model, w.id, w.failureCode
ORDER BY a.time;

// Trend from aggregates on the graph (raw values stay in TimescaleDB)
MATCH (b:Batch)-[:HAS_PHASE_RUN]->(pr:PhaseRun)-[m:MEASURED]->(:Tag {id: 'TT101.PV'}),
      (pr)-[:INSTANCE_OF]->(:Phase {type: 'HOLD'})
WHERE b.id <= 'B-0420'
RETURN b.id, round(m.max, 1) AS max_hold_temp, round(m.avg, 2) AS avg_hold_temp
ORDER BY b.id;

// --- 4. USE CASE: maintenance knowledge --------------------------------
// The removed transmitter was model TX-200. Where else is that model running, and what's its history?
MATCH (d:PhysicalDevice {model: 'TX-200'})-[i:INSTALLED_AT]->(cm:ControlModule)
OPTIONAL MATCH (w:WorkOrder)-[:ON]->(cm)
WHERE w.created >= i.from AND (i.to IS NULL OR w.created <= i.to)
RETURN d.serial, cm.id, i.from, i.to, collect(w.id + ' ' + w.failureCode) AS history;

// --- 5. Scalability: hierarchy as of a date (concept, see slides) ------
// With validFrom/validTo on CONTAINS, a moved Unit keeps its historical context:
// MATCH (pc:ProcessCell)-[r:CONTAINS]->(u:Unit {id: 'M201'})
// WHERE r.validFrom <= date($asOf) AND (r.validTo IS NULL OR date($asOf) < r.validTo)
// RETURN pc.id;
