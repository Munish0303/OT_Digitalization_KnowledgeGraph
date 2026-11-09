// Builds the interview deck: node build.js  ->  ISA88_Knowledge_Graph_Concept.pptx
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const { imageSize } = require("image-size");
const { icon } = require("./icons");

const OUT = "ISA88_Knowledge_Graph_Concept.pptx";
const IMG = path.join(__dirname, "img");

const THEME = {
  name: "Navy Amber",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1A2233", lt1: "FFFFFF", dk2: "14213D", lt2: "F1F4F8",
    accent1: "1F4E79", accent2: "E09F3E", accent3: "C8553D",
    accent4: "9CC3E6", accent5: "6C7A89", accent6: "6A994E",
    hlink: "1F4E79", folHlink: "6C7A89",
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "ISA-88 Knowledge Graph – Concept";
pres.author = "Munish Patwa";
const C = pres.SchemeColor;
const W = 13.333, M = 0.6;

// ---------------------------------------------------------------- layouts
pres.defineSlideMaster({
  title: "TITLE_DARK",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: M, y: 2.2, w: 11.5, h: 1.6, fontSize: 44, bold: true, color: C.background1, align: "left", valign: "bottom", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: M, y: 4.0, w: 11.5, h: 1.0, fontSize: 20, color: C.accent4, valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CLOSING_DARK",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: M, y: 0.9, w: 11.5, h: 1.0, fontSize: 40, bold: true, color: C.background1, align: "left", valign: "bottom", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: M, y: 2.05, w: 11.5, h: 0.6, fontSize: 20, color: C.accent4, align: "left", valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  margin: [0.5, M, 0.5, M],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: M, y: 0.35, w: W - 2 * M, h: 0.75, fontSize: 28, bold: true, color: C.text2, align: "left", valign: "middle", margin: 0 }, text: "" } },
    { text: { text: "ISA-88 Knowledge Graph · Concept", options: { x: M, y: 7.05, w: 6, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
  ],
  slideNumber: { x: W - M - 0.6, y: 7.05, w: 0.6, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
});

// ---------------------------------------------------------------- helpers
const shadow = () => ({ type: "outer", color: "000000", opacity: 0.12, blur: 6, offset: 2, angle: 90 });

function text(slide, t, o) {
  slide.addText(t, { isTextBox: true, margin: 0, fontSize: 14, color: C.text1, valign: "top", ...o });
}

function card(slide, x, y, w, h, fill = C.background2, name) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { color: fill, width: 0 }, shadow: shadow(), objectName: name,
  });
}

function iconCircle(slide, x, y, d, name, fill = C.accent1, stroke = "FFFFFF") {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } });
  const p = d * 0.22;
  slide.addImage({ data: icon(name, stroke), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p });
}

function assumption(slide, x, y, label = "Assumption") {
  slide.addText("⚠ " + label, {
    isTextBox: true, x, y, w: 1.35, h: 0.28, fontSize: 10, bold: true, color: C.text1, align: "center", valign: "middle",
    margin: 0, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.14, fill: { color: C.accent2 }, objectName: "assumption-badge",
  });
}

function arrow(slide, x1, y1, x2, y2, o = {}) {
  slide.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 0.001), h: Math.max(Math.abs(y2 - y1), 0.001),
    flipH: x2 < x1, flipV: y2 < y1,
    line: { color: o.color || C.accent5, width: o.width || 1.25, dashType: o.dash || "solid", endArrowType: o.noHead ? undefined : "triangle" },
  });
}

function relLabel(slide, t, x, y, w = 1.6, o = {}) {
  text(slide, t, { x, y, w, h: 0.24, fontSize: 9, color: C.accent5, align: "center", fontFace: "Consolas", ...o });
}

function screenshot(slide, file, x, y, w, h, caption) {
  const p = path.join(IMG, file);
  if (fs.existsSync(p)) {
    // Fit inside the box, keeping the aspect ratio, centred horizontally and top-aligned.
    const { width, height } = imageSize(p);
    const scale = Math.min(w / width, h / height);
    const iw = width * scale, ih = height * scale;
    slide.addImage({ path: p, x: x + (w - iw) / 2, y, w: iw, h: ih, objectName: "screenshot " + file });
    slide.addShape(pres.shapes.RECTANGLE, { x: x + (w - iw) / 2, y, w: iw, h: ih, fill: { type: "none" }, line: { color: "C9D1DC", width: 0.75 } });
  } else {
    slide.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: C.background2 }, line: { color: C.accent4, width: 1, dashType: "dash" } });
    text(slide, `Screenshot: ${caption}`, { x, y: y + h / 2 - 0.2, w, h: 0.4, align: "center", color: C.accent5 });
  }
}

function code(slide, t, x, y, w, h, fontSize = 11) {
  slide.addText(t, {
    isTextBox: true, x, y, w, h, fontFace: "Consolas", fontSize, color: "E8EEF6", valign: "top",
    margin: [8, 10, 8, 10], fill: { color: C.text1 }, objectName: "code",
  });
}

let section = "";
function slide(master, sec) {
  if (sec && sec !== section) { pres.addSection({ title: sec }); section = sec; }
  return pres.addSlide({ masterName: master, sectionTitle: section });
}

// ============================================================ 1. Title
{
  const s = slide("TITLE_DARK", "Introduction");
  s.addText("From signals to knowledge", { placeholder: "title" });
  s.addText("An ISA-88 knowledge graph in Neo4j, fed from the automation layer by Litmus Edge", { placeholder: "body" });
  text(s, "Munish Patwa  ·  Working Student in Engineering (m/f/d) – 2nd interview", { x: M, y: 5.6, w: 9, h: 0.35, fontSize: 16, color: C.background1 });
  text(s, "Prepared for Givaudan Deutschland GmbH, Dortmund site  ·  November 2026", { x: M, y: 6.0, w: 9, h: 0.35, fontSize: 14, color: C.accent4 });
  // motif: small graph of the three model layers
  const nodes = [[10.6, 0.9, C.accent4], [11.9, 1.5, C.accent2], [11.0, 2.4, C.accent1], [12.3, 0.6, C.accent4]];
  arrow(s, 10.85, 1.15, 11.25, 2.4, { noHead: true, color: C.accent4 });
  arrow(s, 11.25, 2.65, 12.15, 1.75, { noHead: true, color: C.accent4 });
  arrow(s, 10.85, 1.15, 12.15, 1.75, { noHead: true, color: C.accent4 });
  arrow(s, 12.15, 1.75, 12.55, 0.85, { noHead: true, color: C.accent4 });
  nodes.forEach(([x, y, c]) => s.addShape(pres.shapes.OVAL, { x, y, w: 0.5, h: 0.5, fill: { color: c }, line: { color: c } }));
  s.addNotes(
    "Thank you for the invitation. In the next 17 minutes I'll show you a concept for a plant knowledge graph: ISA-88 as the structure, Neo4j as the store, Litmus Edge as the data orchestrator. " +
    "I did not stop at slides: I built a small working prototype with simulated data, and I'm happy to show it live at the end. " +
    "Everything that is an assumption about your site is marked with an orange badge.");
}

// ============================================================ 2. Motivation
{
  const s = slide("CONTENT", "Introduction");
  s.addText("Today, \"what happened in batch X?\" needs six systems", { placeholder: "title" });
  const silos = [
    ["cpu", "PLC / SCADA", "live values, alarms"],
    ["chart", "Historian", "time series"],
    ["flask", "Batch system", "recipes, phases"],
    ["layers", "MES / ERP", "orders, material lots"],
    ["tube", "LIMS", "lab results, specs"],
    ["wrench", "CMMS", "work orders, devices"],
  ];
  silos.forEach(([ic, name, sub], i) => {
    const x = M + i * 2.03, y = 1.55, w = 1.85;
    card(s, x, y, w, 2.0, C.background2, "silo " + name);
    iconCircle(s, x + (w - 0.7) / 2, y + 0.2, 0.7, ic);
    text(s, name, { x: x + 0.05, y: y + 1.0, w: w - 0.1, h: 0.35, fontSize: 16, bold: true, align: "center", color: C.text2 });
    text(s, sub, { x: x + 0.05, y: y + 1.38, w: w - 0.1, h: 0.3, fontSize: 12, align: "center", color: C.accent5 });
  });
  text(s, "Each system knows its own part. Nobody knows how the parts connect.", { x: M, y: 3.75, w: 12, h: 0.4, fontSize: 18, italic: true, color: C.accent1 });

  card(s, M, 4.4, 7.4, 2.05, C.background2);
  text(s, "A typical QA question after a temperature deviation", { x: M + 0.25, y: 4.55, w: 7, h: 0.35, fontSize: 15, bold: true, color: C.text2 });
  text(s, [
    { text: "Which raw-material lots went into the batch, and where did its product go?", options: { bullet: true, breakLine: true } },
    { text: "Was the sensor itself at fault – has it misbehaved before?", options: { bullet: true, breakLine: true } },
    { text: "Is the same device model installed elsewhere?", options: { bullet: true } },
  ], { x: M + 0.25, y: 5.0, w: 7, h: 1.6, fontSize: 14, paraSpaceAfter: 6 });

  card(s, 8.4, 4.4, 4.33, 2.05, C.text2);
  text(s, "hours", { x: 8.6, y: 4.55, w: 1.9, h: 0.8, fontSize: 40, bold: true, color: C.accent2, fontFace: "Cambria" });
  text(s, "→ seconds", { x: 10.4, y: 4.7, w: 2.2, h: 0.6, fontSize: 24, bold: true, color: C.background1 });
  text(s, "manual cross-referencing of exports, paper batch records and maintenance notes vs. one graph query",
    { x: 8.6, y: 5.45, w: 3.95, h: 0.8, fontSize: 13, color: C.accent4 });
  assumption(s, 8.6, 6.05);
  s.addNotes(
    "The starting point in most batch plants: data exists, but in silos. The PLC knows the temperature, the batch system knows the phase, the MES knows the lots, the LIMS knows the lab results, the CMMS knows which transmitter is installed. " +
    "When QA asks the questions on the left after a deviation, someone cross-references exports by hand. My assumption is that this takes hours; I'd love to hear how long it takes at Dortmund today. " +
    "The value of a knowledge graph is not more data – it is the connections between data we already have.");
}

// ============================================================ 3. Target vision & benefits
{
  const s = slide("CONTENT", "Target vision");
  s.addText("Target vision: one connected model of plant, process and history", { placeholder: "title" });
  const roles = [
    ["factory", "Production & QA", ["Genealogy + process context in one query", "Deviation context: phase, equipment, alarms", "Faster batch-record review"]],
    ["wrench", "Maintenance", ["History per position and per device", "Failure patterns across the same model", "From reactive to condition-based"]],
    ["layers", "Engineering", ["Single structured plant model (ISA-88)", "Impact analysis before changes", "Onboarding: the plant is explorable"]],
    ["graph", "Digitalization", ["Reusable foundation for analytics", "Context for AI assistants (GraphRAG)", "Same model for every new Process Cell"]],
  ];
  roles.forEach(([ic, name, items], i) => {
    const x = M + i * 3.07, y = 1.5, w = 2.85;
    card(s, x, y, w, 3.35, C.background2, "role " + name);
    iconCircle(s, x + 0.25, y + 0.25, 0.65, ic);
    text(s, name, { x: x + 1.05, y: y + 0.35, w: w - 1.15, h: 0.45, fontSize: 17, bold: true, color: C.text2, valign: "middle" });
    text(s, items.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < items.length - 1 } })),
      { x: x + 0.25, y: y + 1.15, w: w - 0.4, h: 2.0, fontSize: 14, paraSpaceAfter: 8 });
  });
  const kpis = [["< 1 min", "cross-system batch question (today: hours)"], ["1 model", "ISA-88 structure for engineering, maintenance and QA"], ["0", "write paths back into the control layer"]];
  kpis.forEach(([big, small], i) => {
    const x = M + i * 4.1;
    text(s, big, { x, y: 5.15, w: 3.9, h: 0.75, fontSize: 36, bold: true, color: C.accent1, fontFace: "Cambria" });
    text(s, small, { x, y: 5.9, w: 3.9, h: 0.5, fontSize: 13, color: C.accent5 });
  });
  assumption(s, M, 6.5);
  s.addNotes(
    "The target picture is one connected model that every role can query. For production and QA: genealogy plus process context – not only which lots went in, which the ERP may already answer, but also the phase, equipment and sensor history behind them, in one query.For maintenance: history per position and per physical device. " +
    "For engineering: the plant structure in one place, following ISA-88. And for digitalization: a foundation – the same graph later gives an AI assistant the context it needs. " +
    "The 'less than a minute' is an assumption; the prototype answers it in milliseconds, but real data quality decides this.");
}

// ============================================================ 4. ISA-88 primer
{
  const s = slide("CONTENT", "Data model");
  s.addText("ISA-88 gives the structure: where (physical) and how (procedural)", { placeholder: "title" });
  text(s, "Physical Model – where", { x: M, y: 1.35, w: 5.5, h: 0.4, fontSize: 18, bold: true, color: C.accent1 });
  const phys = [["Enterprise", "Givaudan"], ["Site", "Dortmund"], ["Area", "Production"], ["Process Cell", "PC-01 Compounding"],
    ["Unit", "Reactor R-101"], ["Equipment Module", "R-101 Temp. Control"], ["Control Module", "TT-101 (temperature)"]];
  phys.forEach(([lvl, ex], i) => {
    const x = M + i * 0.2, y = 1.85 + i * 0.66, w = 6.0 - i * 0.2;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.54, rectRadius: 0.06, fill: { color: i < 4 ? C.accent4 : C.accent1 }, line: { color: C.background1, width: 0 } });
    text(s, lvl, { x: x + 0.15, y, w: 2.2, h: 0.54, fontSize: 14, bold: true, color: i < 4 ? C.text2 : C.background1, valign: "middle" });
    text(s, ex, { x: M + 3.55, y, w: 2.4, h: 0.54, fontSize: 13, color: i < 4 ? C.text2 : C.background1, valign: "middle" });
  });
  text(s, "Procedural Model – how", { x: 7.6, y: 1.35, w: 5.1, h: 0.4, fontSize: 18, bold: true, color: C.accent1 });
  const proc = [["Procedure", "Master Recipe \"Citrus Base\" v3"], ["Unit Procedure", "Reaction"], ["Operation", "React"], ["Phase", "Heat to 85 °C"]];
  proc.forEach(([lvl, ex], i) => {
    const x = 7.6 + i * 0.28, y = 1.85 + i * 0.66, w = 5.1 - i * 0.28;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.54, rectRadius: 0.06, fill: { color: C.accent2 }, line: { color: C.background1, width: 0 } });
    text(s, lvl, { x: x + 0.15, y, w: 1.8, h: 0.54, fontSize: 14, bold: true, color: C.text1, valign: "middle" });
    text(s, ex, { x: x + 1.95, y, w: w - 2.05, h: 0.54, fontSize: 13, color: C.text1, valign: "middle" });
  });
  card(s, 7.6, 4.65, 5.13, 1.95, C.background2, "link box");
  text(s, "The link is what makes it a graph", { x: 7.8, y: 4.75, w: 4.8, h: 0.35, fontSize: 15, bold: true, color: C.text2 });
  text(s, [
    { text: "Unit Procedure ", options: { bold: true } }, { text: "runs on a ", options: {} }, { text: "Unit", options: { bold: true, breakLine: true } },
    { text: "Phase ", options: { bold: true } }, { text: "runs on an ", options: {} }, { text: "Equipment Module", options: { bold: true, breakLine: true } },
    { text: "Recipe = what should happen · Batch = what did happen", options: { italic: true, color: C.accent1 } },
  ], { x: 7.8, y: 5.15, w: 4.8, h: 1.35, fontSize: 14, paraSpaceAfter: 6 });
  assumption(s, 4.95, 1.42, "Example plant");
  s.addNotes(
    "Quick recap of ISA-88. The physical model describes where things happen – down to the Control Module, a single transmitter or valve. The procedural model describes how – a recipe broken down into unit procedures, operations and phases. " +
    "Two points matter for the graph: first, the two models are linked – a phase runs on an equipment module. Second, ISA-88 separates the recipe, what should happen, from the batch, what actually happened. " +
    "A tree alone would fit in a relational table. These cross-links are why a graph database pays off. The example plant – PC-01 with a reactor, a mixer and a tank – is my assumption.");
}

// ============================================================ 5. Data model as graph
{
  const s = slide("CONTENT", "Data model");
  s.addText("Data model: ISA-88 as a property graph in Neo4j", { placeholder: "title" });
  const colA = 0.6, colB = 5.0, colC = 9.55, cw = 2.5, nh = 0.42;
  const row = (i) => 1.62 + i * 0.6;
  const heads = [[colA, "Physical Model", C.accent1], [colB, "Execution – what happened", "A8701F"], [colC, "Procedural Model – what should happen", C.accent5]];
  heads.forEach(([x, t, c]) => text(s, t, { x, y: 1.2, w: 3.3, h: 0.3, fontSize: 13, bold: true, color: c }));
  function node(x, r, label, fill, fg = "FFFFFF", w = cw) {
    s.addText(label, { isTextBox: true, x, y: row(r), w, h: nh, fontSize: 12, bold: true, color: fg, align: "center", valign: "middle", margin: 0,
      shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.2, fill: { color: fill }, objectName: "node " + label });
  }
  const physical = [":Equipment:Enterprise", ":Equipment:Site", ":Equipment:Area", ":Equipment:ProcessCell", ":Equipment:Unit", ":Equipment:EquipmentModule", ":Equipment:ControlModule"];
  physical.forEach((l, i) => {
    node(colA, i, l, i < 4 ? C.accent4 : C.accent1, i < 4 ? C.text2 : "FFFFFF");
    if (i > 0) arrow(s, colA + cw / 2, row(i - 1) + nh, colA + cw / 2, row(i));
  });
  relLabel(s, "CONTAINS {validFrom}", colA + cw / 2 + 0.05, row(0) + nh - 0.02, 1.7, { align: "left" });
  node(colA, 7, ":Tag", C.accent1, "FFFFFF", 0.95);
  node(colA + 1.1, 7, ":PhysicalDevice", C.accent1, "FFFFFF", 1.4);
  arrow(s, colA + 0.47, row(6) + nh, colA + 0.47, row(7));
  arrow(s, colA + 1.8, row(7), colA + 1.8, row(6) + nh);
  relLabel(s, "↑ HAS_TAG", colA, row(7) + nh + 0.03, 0.95);
  relLabel(s, "↓ INSTALLED_AT {from,to}", colA + 0.9, row(7) + nh + 0.03, 1.8);

  const exe = "E09F3E";
  node(colB, 1, ":MaterialLot", exe, "1A2233");
  node(colB, 3, ":Batch", exe, "1A2233");
  node(colB, 5, ":PhaseRun", exe, "1A2233");
  node(colB, 6.5, ":Alarm", "C8553D");
  node(colB, 7.6, ":WorkOrder", C.accent5);
  arrow(s, colB + cw / 2, row(3), colB + cw / 2, row(1) + nh);
  relLabel(s, "CONSUMED / PRODUCED", colB + cw / 2 + 0.05, row(2) - 0.05, 1.9, { align: "left" });
  arrow(s, colB + cw / 2, row(3) + nh, colB + cw / 2, row(5));
  relLabel(s, "HAS_PHASE_RUN", colB + cw / 2 + 0.05, row(4) - 0.05, 1.6, { align: "left" });
  arrow(s, colB + cw / 2, row(6.5), colB + cw / 2, row(5) + nh);
  relLabel(s, "DURING", colB + cw / 2 + 0.05, row(5) + nh + 0.06, 0.8, { align: "left" });
  // cross links to physical
  arrow(s, colB, row(5) + nh / 2, colA + cw, row(5) + nh / 2, { color: C.accent1, width: 1.5 });
  relLabel(s, "EXECUTED_ON", colA + cw + 0.2, row(5) + nh / 2 - 0.26, 1.6);
  arrow(s, colB, row(6.5) + nh / 2, colA + cw, row(6) + nh / 2, { color: "C8553D", width: 1.5 });
  relLabel(s, "RAISED_BY", colA + cw + 0.75, row(6) + nh / 2 - 0.12, 1.2);
  arrow(s, colB, row(7.6) + nh / 2, colA + cw + 0.05, row(6) + nh, { color: C.accent5 });
  relLabel(s, "ON", colA + cw + 1.25, row(7.1) + 0.12, 0.4);

  const proc = C.accent5;
  node(colC, 2, ":MasterRecipe", proc);
  node(colC, 3, ":UnitProcedure", proc);
  node(colC, 4, ":Operation", proc);
  node(colC, 5, ":Phase  {sp_*}", proc);
  [2, 3, 4].forEach((i) => arrow(s, colC + cw / 2, row(i) + nh, colC + cw / 2, row(i + 1)));
  arrow(s, colB + cw, row(3) + nh / 2, colC, row(2) + nh / 2, { color: proc, width: 1.5 });
  relLabel(s, "FOLLOWS", colB + cw + 0.45, row(2) + nh / 2 + 0.02, 1.2);
  arrow(s, colB + cw, row(5) + nh / 2, colC, row(5) + nh / 2, { color: proc, width: 1.5 });
  relLabel(s, "INSTANCE_OF", colB + cw + 0.3, row(5) + nh / 2 - 0.26, 1.4);

  // design decision chips
  const chips = [
    ["Two labels per node", "(:Equipment:Unit) → \"everything below Area X\" at any depth"],
    ["Position ≠ device", "TT-101 is a Control Module; the transmitter is a PhysicalDevice"],
    ["No raw time series", "PhaseRun-[:MEASURED {min,max,avg}]→Tag; values stay in TimescaleDB"],
  ];
  chips.forEach(([h, t], i) => {
    const x = 7.9, y = 5.28 + i * 0.6;
    card(s, x, y, 4.83, 0.54, C.background2, "chip " + h);
    text(s, h, { x: x + 0.15, y: y + 0.03, w: 4.6, h: 0.24, fontSize: 12, bold: true, color: C.text2 });
    text(s, t, { x: x + 0.15, y: y + 0.27, w: 4.6, h: 0.24, fontSize: 11, color: C.accent5 });
  });
  s.addNotes(
    "Here is the model. Three groups. Left, the physical model: every equipment node carries a generic Equipment label plus its ISA-88 level, connected with CONTAINS. " +
    "Right, the procedural model: Master Recipe down to Phase, with the setpoints as properties. In the middle, the execution: a Batch FOLLOWS a recipe, has Phase Runs, each an INSTANCE_OF a recipe phase and EXECUTED_ON an equipment module. Material lots hang off the batch, alarms are RAISED_BY a control module and linked to the Phase Run that was active. " +
    "Three decisions I want to highlight: two labels per node lets me query any depth even if the hierarchy changes. A position is not a device – that's what makes the maintenance use case work. And raw time series stay out of Neo4j: the graph stores aggregates and a reference.");
}

// ============================================================ 6. Architecture & data flow
{
  const s = slide("CONTENT", "Architecture");
  s.addText("Architecture: Litmus Edge orchestrates, data flows upwards only", { placeholder: "title" });
  const lanes = [
    ["Level 0–2 · Field & control", 0.6, 2.55, C.background2],
    ["Level 3 · Site operations", 3.3, 3.0, C.background2],
    ["Level 3.5 · Industrial DMZ", 6.45, 2.95, "FBF0DE"],
    ["Level 4 · Enterprise IT", 9.55, 3.18, C.background2],
  ];
  lanes.forEach(([t, x, w, fill]) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.25, w, h: 4.25, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: "lane " + t });
    text(s, t, { x: x + 0.12, y: 1.32, w: w - 0.2, h: 0.3, fontSize: 12, bold: true, color: C.text2 });
  });
  function box(x, y, w, h, title, sub, fill = C.background1, fg = C.text2) {
    card(s, x, y, w, h, fill, "box " + title);
    text(s, title, { x: x + 0.1, y: y + 0.06, w: w - 0.2, h: 0.3, fontSize: 13, bold: true, color: fg });
    if (sub) text(s, sub, { x: x + 0.1, y: y + 0.36, w: w - 0.2, h: h - 0.4, fontSize: 10.5, color: fg === C.text2 ? C.accent5 : C.accent4 });
  }
  box(0.75, 1.8, 2.25, 0.85, "Sensors / actuators", "4–20 mA, IO-Link, Profibus");
  box(0.75, 2.85, 2.25, 0.85, "PLCs", "S7, Modbus TCP, OPC UA server");
  box(0.75, 3.9, 2.25, 1.2, "SCADA / batch system", "phase & batch events, alarms (OPC UA A&C)");
  box(3.45, 1.8, 2.7, 2.35, "Litmus Edge", "DeviceHub drivers: OPC UA, Modbus, S7\nNormalise + map to UNS topic\nBuffer (store & forward)\nOutbound only to LEM", C.text2, C.background1);
  box(3.45, 4.3, 2.7, 0.85, "MES (lots, orders)", "ISA-95 level 3 – via REST/SQL");
  box(6.6, 1.8, 2.65, 0.8, "MQTT broker", "TLS 8883 · ACL per client");
  box(6.6, 2.8, 2.65, 0.8, "Ingest service", "idempotent writes, topic check");
  box(6.6, 3.8, 2.65, 1.3, "TimescaleDB", "staging + raw time series\n(prod: existing historian)");
  // CMMS / ERP master data sits on top so its arrow into the sync job crosses nothing.
  box(9.7, 1.8, 2.9, 0.6, "CMMS / ERP export", "work orders, devices");
  box(9.7, 2.6, 2.9, 0.8, "Sync job", "watermark + Cypher MERGE");
  box(9.7, 3.6, 2.9, 0.8, "Neo4j knowledge graph", "Bolt over TLS · RBAC", C.accent1, C.background1);
  box(9.7, 4.6, 2.9, 0.6, "Apps", "Streamlit · Browser · BI / AI");
  arrow(s, 3.0, 3.25, 3.45, 3.0, { color: C.accent1, width: 2 });
  arrow(s, 3.0, 4.4, 3.45, 3.6, { color: C.accent1, width: 2 });
  arrow(s, 6.15, 2.2, 6.6, 2.2, { color: C.accent1, width: 2 });
  arrow(s, 7.9, 2.6, 7.9, 2.8, { color: C.accent1, width: 2 });
  arrow(s, 7.9, 3.6, 7.9, 3.8, { color: C.accent1, width: 2 });
  arrow(s, 9.25, 4.3, 9.7, 3.0, { color: C.accent1, width: 2 });
  arrow(s, 11.15, 2.4, 11.15, 2.6, { color: C.accent5, width: 1.25, dash: "dash" });
  arrow(s, 11.15, 3.4, 11.15, 3.6, { color: C.accent1, width: 2 });
  arrow(s, 11.15, 4.4, 11.15, 4.6, { color: C.accent1, width: 2 });
  arrow(s, 6.15, 4.7, 6.6, 2.4, { color: C.accent5, width: 1.25, dash: "dash" });
  // protocol strip
  text(s, "Unified Namespace topic = ISA-88 path", { x: M, y: 5.7, w: 5.2, h: 0.3, fontSize: 13, bold: true, color: C.text2 });
  code(s, "givaudan/dortmund/production/pc01/r101/r101-temp/tt101/pv\n{\"deviceName\":\"PLC-PC01\",\"tagName\":\"TT101.PV\",\n \"value\":85.2,\"timestamp\":1792345200000,\"success\":true}", M, 6.0, 6.1, 0.95, 10.5);
  text(s, [
    { text: "Raw values → TimescaleDB; only context → Neo4j", options: { bullet: true, breakLine: true } },
    { text: "New equipment appears via its topic, but is only accepted if it exists in the Engineering Master List", options: { bullet: true, breakLine: true } },
    { text: "Prototype: every box is a container; Litmus Edge simulated with its real payload format", options: { bullet: true } },
  ], { x: 7.0, y: 5.7, w: 5.73, h: 1.3, fontSize: 12, paraSpaceAfter: 4 });
  assumption(s, 1.65, 5.17, "Site systems");
  s.addNotes(
    "The architecture follows the Purdue model from left to right. Litmus Edge sits at level 3: it connects to the PLCs and the batch system with its DeviceHub drivers – OPC UA, Modbus, S7 – normalises the tags and publishes them on topics that follow the ISA-88 path. That's the Unified Namespace. " +
    "In the DMZ, an MQTT broker receives everything over TLS; an ingest service writes raw values and events into TimescaleDB, which serves as staging and time-series store – in production that could be the existing historian. " +
    "On the IT side, a sync job pulls new events every few seconds using a watermark and writes them into Neo4j with MERGE, so it can always be re-run safely. Master data – the equipment list, recipes, CMMS – comes in as a second input. " +
    "Litmus also has a native PostgreSQL connector, so the MQTT hop could be removed; I kept MQTT because it decouples consumers.");
}

// ============================================================ 7. Security
{
  const s = slide("CONTENT", "Architecture");
  s.addText("Security: zones and conduits, no write-back, least privilege", { placeholder: "title" });
  const items = [
    ["shield", "OT/IT separation (IEC 62443 zones)", "Litmus Edge in L3, broker + time series in the DMZ, graph in IT. Firewalls on both sides of the DMZ; no direct IT→OT path."],
    ["route", "One-way data flow", "Connections are only opened from the lower zone outwards. The graph never writes back to the control layer – insights reach the plant through people and the CMMS."],
    ["lock", "Encryption & identity", "TLS on MQTT, SQL and Bolt; certificate per edge device; broker ACLs (edge may only publish, ingest only subscribe); secrets in a vault."],
    ["users", "Access to the knowledge graph", "Neo4j Enterprise RBAC: sync = only writer; engineering / maintenance / QA = read roles; SSO via AD / Entra ID."],
  ];
  items.forEach(([ic, h, t], i) => {
    const y = 1.45 + i * 1.3;
    iconCircle(s, M, y + 0.05, 0.62, ic);
    text(s, h, { x: M + 0.85, y, w: 6.3, h: 0.35, fontSize: 16, bold: true, color: C.text2 });
    text(s, t, { x: M + 0.85, y: y + 0.38, w: 6.3, h: 0.8, fontSize: 13, color: C.text1 });
  });
  card(s, 8.0, 1.45, 4.73, 3.55, C.text2, "recipe ip");
  iconCircle(s, 8.25, 1.7, 0.62, "flask", C.accent2, "1A2233");
  text(s, "The recipe is the crown jewel", { x: 9.05, y: 1.75, w: 3.5, h: 0.55, fontSize: 17, bold: true, color: C.background1, valign: "middle" });
  text(s, [
    { text: "Setpoints (sp_*) live only on Phase nodes", options: { bullet: true, breakLine: true } },
    { text: "Property-level privileges hide them from non-production roles", options: { bullet: true, breakLine: true } },
    { text: "Maintenance sees equipment + history, not formulas", options: { bullet: true, breakLine: true } },
    { text: "All queries audited (query log)", options: { bullet: true } },
  ], { x: 8.25, y: 2.55, w: 4.3, h: 2.3, fontSize: 13, color: C.background1, paraSpaceAfter: 6 });
  code(s, "DENY READ {sp_temperature_c, sp_amount_kg}\n  ON GRAPH plant NODES Phase TO maintenance_reader;", 8.0, 5.2, 4.73, 0.62, 11);
  text(s, "Demo runs Neo4j Community (no RBAC); roles shown as concept.", { x: 8.0, y: 5.95, w: 4.73, h: 0.3, fontSize: 11, italic: true, color: C.accent5 });
  s.addNotes(
    "Security is non-negotiable in OT, so the design starts from zones and conduits as in IEC 62443. Data moves only upwards and outwards; nothing in IT can open a connection into the plant network, and the graph has no write-back. " +
    "If the graph is wrong or compromised, production is unaffected. That's a conscious trade-off: we give up closed-loop automation for now. " +
    "For the graph itself: TLS everywhere, the sync service is the only writer, and people get read roles via SSO. And because this is a flavours and fragrances company, the recipe is intellectual property – Neo4j Enterprise can hide the setpoint properties from roles that don't need them.");
}

// ============================================================ 8. Use case: traceability
{
  const s = slide("CONTENT", "Use cases");
  s.addText("Use case 1 – traceability: B-0412 ran too hot. What is affected?", { placeholder: "title" });
  screenshot(s, "app_trace.png", 5.55, 1.3, 7.18, 4.95, "Streamlit – Batch traceability for B-0412");
  const steps = [
    ["1", "HIHI alarm on TT-101 during Hold", "Alarm -[:DURING]→ PhaseRun links it to the batch"],
    ["2", "Upstream", "which raw-material lots went in"],
    ["3", "Downstream", "L-CB-0412 → B-0413, B-0414 → product lots on QA hold"],
  ];
  steps.forEach(([n, h, t], i) => {
    const y = 1.35 + i * 0.85;
    s.addText(n, { isTextBox: true, x: M, y, w: 0.45, h: 0.45, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle", margin: 0, shape: pres.shapes.OVAL, fill: { color: C.accent2 } });
    text(s, h, { x: M + 0.6, y: y - 0.02, w: 4.2, h: 0.3, fontSize: 14, bold: true, color: C.text2 });
    text(s, t, { x: M + 0.6, y: y + 0.28, w: 4.2, h: 0.45, fontSize: 12, color: C.accent5 });
  });
  code(s, "MATCH (b:Batch {id:'B-0412'})-[:PRODUCED]->(l0)\nMATCH path = (l0)\n  ((:MaterialLot)<-[:CONSUMED]-(:Batch)\n   -[:PRODUCED]->(:MaterialLot)){0,5}\nRETURN [n IN nodes(path) | n.id]", M, 3.95, 4.75, 1.55, 11);
  text(s, "One query, any number of genealogy levels – in SQL this is a recursive join across MES, batch and historian data.",
    { x: M, y: 5.6, w: 4.75, h: 0.65, fontSize: 12, italic: true, color: C.accent1 });
  text(s, "Live demo available · simulated data", { x: 5.55, y: 6.35, w: 7.18, h: 0.3, fontSize: 11, color: C.accent5, align: "right" });
  s.addNotes(
    "Let me make this concrete with one story that runs through all use cases. Batch B-0412, Citrus Base, raises a high-high alarm on TT-101 during the Hold phase. " +
    "Because the alarm is linked to the Phase Run, and the Phase Run to the batch, the graph immediately gives QA the full picture: which raw material lots went in, which intermediate lot came out, and that this lot was used in two Lemon Compound batches whose product lots should go on hold. " +
    "The Cypher on the left is the whole genealogy – one quantified path pattern, any depth. The screenshot is from my prototype; the temperature curve below comes from TimescaleDB, located through the graph.");
}

// ============================================================ 9. Use cases 2+3
{
  const s = slide("CONTENT", "Use cases");
  s.addText("Use cases 2 + 3 – find the cause, prevent the next failure", { placeholder: "title" });
  // left: fault analysis
  iconCircle(s, M, 1.35, 0.55, "alert", C.accent3);
  text(s, "Fault analysis", { x: M + 0.7, y: 1.4, w: 5, h: 0.45, fontSize: 18, bold: true, color: C.text2, valign: "middle" });
  text(s, "Was it the process or the sensor? TT-101 already warned in B-0400 and B-0406 – the work order then said \"no fault found\".",
    { x: M, y: 1.98, w: 5.85, h: 0.65, fontSize: 13 });
  screenshot(s, "app_fault.png", M, 2.7, 5.85, 3.0, "Fault analysis – TT-101 peaks per batch, coloured by installed device");
  code(s, "(alarm:Alarm)-[:RAISED_BY]->(cm)<-[i:INSTALLED_AT]-(d:PhysicalDevice)\nWHERE i.from <= alarm.time AND (i.to IS NULL OR alarm.time < i.to)", M, 5.85, 5.85, 0.62, 10);
  // right: maintenance
  const x2 = 6.88;
  iconCircle(s, x2, 1.35, 0.55, "wrench", C.accent1);
  text(s, "Maintenance knowledge", { x: x2 + 0.7, y: 1.4, w: 5, h: 0.45, fontSize: 18, bold: true, color: C.text2, valign: "middle" });
  text(s, "The removed transmitter was model TX-200. The same model still runs at TT-301 – which drifted once before.",
    { x: x2, y: 1.98, w: 5.85, h: 0.65, fontSize: 13 });
  screenshot(s, "app_maint.png", x2, 2.7, 5.85, 3.0, "Maintenance – where model TX-200 is installed, with history");
  card(s, x2, 5.85, 5.85, 0.62, C.text2, "recommendation");
  text(s, "→ Recommendation: calibrate TT-301 before its next batch", { x: x2 + 0.2, y: 5.85, w: 5.5, h: 0.62, fontSize: 14, bold: true, color: C.accent2, valign: "middle" });
  s.addNotes(
    "The same graph answers the next two questions without any new integration. Fault analysis: was it the process or the sensor? The alarm history shows TT-101 warned twice before, and the maintenance check then found nothing. " +
    "Because aggregates per phase are stored on the graph, I can plot the peak temperature per batch and colour it by the physical device that was installed – the drift is obvious, and it disappears after the replacement. " +
    "Maintenance knowledge: the removed transmitter was model TX-200. The graph knows the same model is installed at TT-301, which had a drift finding before. So instead of waiting for the next alarm, maintenance can calibrate it proactively. That's the step from reactive to preventive.");
}

// ============================================================ 10. Scalability & maintainability
{
  const s = slide("CONTENT", "Outlook");
  s.addText("Scalability & maintainability: grow by adding, not by migrating", { placeholder: "title" });
  const cells = [
    ["factory", "More Process Cells in Dortmund", "A new Process Cell = new rows in the Engineering Master List + its tags mapped in Litmus Edge. The UNS path and the graph model stay the same."],
    ["layers", "New data types", "A new source = new labels + relationships + one loader. Existing queries keep working – no schema migration (e.g. quality results, energy, CIP cycles)."],
    ["route", "Changes to the hierarchy", "CONTAINS carries validFrom / validTo: a Unit moved to another Process Cell keeps its history. The Engineering Master List stays the single owner."],
    ["db", "Data volume & performance", "Raw time series never enter Neo4j; per-phase aggregates do. Indexes on ids and times. Sync scales out from polling to CDC (Debezium → Kafka → Neo4j connector)."],
  ];
  cells.forEach(([ic, h, t], i) => {
    const x = M + (i % 2) * 6.13, y = 1.4 + Math.floor(i / 2) * 2.3, w = 5.93, hh = 2.05;
    card(s, x, y, w, hh, C.background2, "cell " + h);
    iconCircle(s, x + 0.25, y + 0.25, 0.6, ic);
    text(s, h, { x: x + 1.05, y: y + 0.3, w: w - 1.2, h: 0.45, fontSize: 17, bold: true, color: C.text2, valign: "middle" });
    text(s, t, { x: x + 0.25, y: y + 0.98, w: w - 0.5, h: 1.0, fontSize: 13 });
  });
  code(s, "MATCH (pc:ProcessCell)-[r:CONTAINS]->(:Unit {id:'M201'})\nWHERE r.validFrom <= date($asOf) AND (r.validTo IS NULL OR date($asOf) < r.validTo)", M, 6.15, 12.13, 0.65, 11);
  s.addNotes(
    "How does it grow? Within Dortmund, a new Process Cell is just new rows in the engineering master list and its tags mapped in Litmus Edge; because the topic path and the graph both follow ISA-88, it is the same model again. " +
    "New data types are just new labels and relationships – no migration, existing queries keep working. Hierarchy changes are handled by validity periods on CONTAINS, so history stays correct – the query at the bottom answers 'where was M-201 at that date'. " +
    "And performance: the expensive data – raw time series – never enters the graph. If polling gets too slow, the sync moves to change data capture with Kafka.");
}

// ============================================================ 11. Challenges
{
  const s = slide("CONTENT", "Outlook");
  s.addText("Challenges & open questions – and how I'd address them", { placeholder: "title" });
  const rows = [
    ["Master-data quality", "Tag names and hierarchy are inconsistent in legacy systems", "Start with one Process Cell; Engineering Master List as owner; unknown topics flagged, not auto-created"],
    ["PLC connectivity", "Mixed PLCs / DCS, incomplete tag docs; direct access may need PLC changes", "Read via the existing SCADA/DCS OPC UA server, no PLC changes; small tag set, slow polling"],
    ["OT change management", "New edge connections touch validated control systems", "Read-only drivers, no write-back, change requests with automation team, test on a non-production line"],
    ["Ownership & adoption", "Who maintains the model? Will people use it?", "Clear data owners per source; build use cases with QA and maintenance, not for them"],
    ["Licences & skills", "Litmus, Neo4j Enterprise, Cypher know-how", "Pilot on Community / trials, measure value, then decide; short Cypher training"],
  ];
  const x0 = M, cols = [2.3, 4.6, 5.23];
  const hdr = ["Challenge", "Risk / open question", "Mitigation"];
  let x = x0;
  hdr.forEach((h, i) => { text(s, h, { x: x + 0.1, y: 1.3, w: cols[i] - 0.2, h: 0.35, fontSize: 13, bold: true, color: C.accent1 }); x += cols[i]; });
  rows.forEach((r, j) => {
    const y = 1.7 + j * 0.98;
    if (j % 2 === 0) s.addShape(pres.shapes.RECTANGLE, { x: x0, y, w: 12.13, h: 0.9, fill: { color: C.background2 }, line: { color: C.background2, width: 0 } });
    let xx = x0;
    r.forEach((c, i) => {
      text(s, c, { x: xx + 0.1, y: y + 0.08, w: cols[i] - 0.25, h: 0.75, fontSize: i === 0 ? 14 : 13, bold: i === 0, color: i === 0 ? C.text2 : C.text1, valign: "middle" });
      xx += cols[i];
    });
  });
  s.addNotes(
    "Where could this fail? Honestly, mostly not in the technology. The biggest risk is master data: in brownfield plants tag names and hierarchies are inconsistent, so I'd start small and make the engineering master list the owner. " +
    "Second, connectivity: plants mix PLC and DCS types, tag documentation is often incomplete, and direct PLC access can mean changing the PLC itself. So I'd read through the existing SCADA or DCS OPC UA server first, with a small tag set and slow polling. Third, any new connection to control systems needs proper OT change management. " +
    "And finally ownership and adoption – the graph is only as good as the people maintaining it. These are also my open questions to you: how are tags and hierarchies maintained in Dortmund today?");
}

// ============================================================ 12. Roadmap & close
{
  const s = slide("CLOSING_DARK", "Outlook");
  s.addText("Start small, prove value, then extend", { placeholder: "title" });
  s.addText("Pilot on one Process Cell with one use case – the model and pipeline repeat for every cell in Dortmund", { placeholder: "body" });
  const phases = [
    ["0–3 months", "Pilot", "PC-01 · batch traceability · read-only · measure query time vs. today"],
    ["3–9 months", "Extend", "all Process Cells · CMMS integration · fault & maintenance use cases"],
    ["9+ months", "Deepen", "more Dortmund sources (quality, energy, CIP) · AI assistant on the graph (GraphRAG)"],
  ];
  phases.forEach(([when, name, what], i) => {
    const x = M + i * 4.1, y = 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 3.9, h: 1.65, rectRadius: 0.08, fill: { color: "1B3A63" }, line: { color: "1B3A63", width: 0 } });
    text(s, when, { x: x + 0.2, y: y + 0.12, w: 3.5, h: 0.3, fontSize: 12, color: C.accent4 });
    text(s, name, { x: x + 0.2, y: y + 0.4, w: 3.5, h: 0.4, fontSize: 20, bold: true, color: C.accent2, fontFace: "Cambria" });
    text(s, what, { x: x + 0.2, y: y + 0.85, w: 3.5, h: 0.75, fontSize: 12.5, color: C.background1 });
  });
  text(s, "Thank you!", { x: M, y: 5.35, w: 8, h: 0.7, fontSize: 36, bold: true, color: C.accent2, fontFace: "Cambria" });
  text(s, "Questions, discussion – or a live demo of the prototype", { x: M, y: 6.05, w: 8, h: 0.4, fontSize: 18, color: C.background1 });
  text(s, "github.com/<your-account>/isa88-knowledge-graph", { x: M, y: 6.5, w: 8, h: 0.35, fontSize: 14, color: C.accent4 });
  s.addNotes(
    "To close: I'd start with a pilot on one process cell and one use case – traceability – read-only, and measure the time saved against today. If that holds, extend to all Process Cells in Dortmund and bring in the CMMS for the maintenance use cases; then add further Dortmund sources such as quality and energy data. " +
    "The long-term payoff is that the graph becomes the context layer for AI assistants. Thank you – I'm happy to take questions, or to show you the prototype running live.");
}

// ============================================================ Backup A: assumptions
{
  const s = slide("CONTENT", "Backup");
  s.addText("Backup: assumptions used in this concept", { placeholder: "title" });
  const a = [
    ["Plant", "Process Cell PC-01 \"Compounding\" with Reactor R-101, Mixer M-201, Storage Tank T-301; 25 equipment nodes"],
    ["Automation", "Batch control system with OPC UA access to tags, phase/batch events and alarms (e.g. SIMATIC Batch or similar)"],
    ["Time series", "An existing site historian could replace TimescaleDB; the graph only stores a reference"],
    ["IT systems", "MES at ISA-95 level 3 provides material lots; SAP PM (or similar) exports work orders and installed devices"],
    ["Recipes", "\"Citrus Base\" (intermediate) feeds \"Lemon Compound\"; setpoints and recipes are invented"],
    ["Numbers", "\"Hours → seconds\" and the pilot timeline are estimates to be validated with the site"],
    ["Prototype", "Litmus Edge simulated with its documented payload format; real Litmus Edge Developer Edition tested separately"],
  ];
  a.forEach(([k, v], i) => {
    const y = 1.35 + i * 0.75;
    assumption(s, M, y + 0.1, k);
    text(s, v, { x: M + 1.6, y, w: 10.5, h: 0.5, fontSize: 14, valign: "middle" });
  });
  s.addNotes("Backup slide – all assumptions in one place.");
}

// ============================================================ Backup B: node & relationship reference
{
  const s = slide("CONTENT", "Backup");
  s.addText("Backup: node types, relationships and key properties", { placeholder: "title" });
  const rows = [
    ["Equipment (+ level label)", "id, name, level", "CONTAINS {validFrom, validTo}"],
    ["Tag", "id, topic, engUnit, limits, timeSeriesStore", "(ControlModule)-[:HAS_TAG]->(Tag)"],
    ["PhysicalDevice", "serial, model, manufacturer", "INSTALLED_AT {from, to} → ControlModule"],
    ["MasterRecipe / UnitProcedure / Operation / Phase", "id, name, version, sp_* setpoints", "HAS_UNIT_PROCEDURE / HAS_OPERATION / HAS_PHASE, RUNS_ON"],
    ["Batch", "id, start, end, status", "FOLLOWS, HAS_PHASE_RUN, CONSUMED / PRODUCED {qtyKg}"],
    ["PhaseRun", "id, start, end, actual_*", "INSTANCE_OF, EXECUTED_ON, MEASURED {min, max, avg}"],
    ["MaterialLot / Material", "id, name", "OF_MATERIAL"],
    ["Alarm", "id, time, level, severity, value, limit", "RAISED_BY, DURING"],
    ["WorkOrder", "id, created, completed, failureCode", "ON, TRIGGERED_BY, REMOVED / INSTALLED"],
  ];
  const opts = { fontSize: 12, color: C.text1, valign: "middle", margin: [2, 6, 2, 6] };
  const head = ["Label", "Properties", "Relationships"].map((t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.accent1 }, fontSize: 13 } }));
  s.addTable([head, ...rows.map((r, i) => r.map((t) => ({ text: t, options: { fill: { color: i % 2 ? "FFFFFF" : THEME.colors.lt2 } } })))], {
    x: M, y: 1.35, w: 12.13, colW: [3.6, 4.0, 4.53], rowH: 0.5, ...opts, border: { type: "solid", pt: 0.5, color: "D6DDE6" },
  });
  s.addNotes("Backup slide – reference for questions on the data model.");
}

// ============================================================ write
// pptxgenjs always writes the default Office colours, so the palette is put into the theme afterwards.
async function applyPalette(file, theme) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const part = "ppt/theme/theme1.xml";
  const scheme = `<a:clrScheme name="${theme.name}">` +
    Object.entries(theme.colors).map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const xml = (await zip.file(part).async("string")).replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, scheme);
  zip.file(part, xml);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyPalette(OUT, THEME);
  console.log("wrote", OUT);
})();
