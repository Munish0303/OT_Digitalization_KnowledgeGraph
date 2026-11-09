import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import dagre from "cytoscape-dagre";
import { caption, kind } from "../kg.js";
import { cssVar, domainOf, useTheme } from "../ui.jsx";

cytoscape.use(fcose);
cytoscape.use(dagre);

const LEVEL_SIZE = { Enterprise: 34, Site: 32, Area: 30, ProcessCell: 30, Unit: 28, EquipmentModule: 24, ControlModule: 20 };

const LAYOUTS = {
  fcose: { name: "fcose", quality: "proof", animate: false, nodeRepulsion: 12000, idealEdgeLength: 90, nodeSeparation: 110, padding: 30, randomize: true },
  lr: { name: "dagre", rankDir: "LR", nodeSep: 14, rankSep: 70, padding: 24, animate: false },
  tb: { name: "dagre", rankDir: "TB", nodeSep: 16, rankSep: 55, padding: 24, animate: false },
};

/**
 * keys: node keys to show. All relationships between them are drawn.
 * selected: node key to highlight. onSelect(key|null) on tap.
 */
export default function GraphCanvas({ kg, keys, selected, onSelect, layout = "fcose", edgeLabels, hideTypes = [], fitKey, captionFn = caption }) {
  const el = useRef(null);
  const cy = useRef(null);
  const theme = useTheme();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const set = new Set(keys);
    const nodes = keys.map((k) => kg.get(k)).filter(Boolean).map((n) => {
      const k = kind(n);
      const d = domainOf(k);
      return { data: { id: n.key, label: captionFn(n), kind: k, color: cssVar(d.color), shape: d.shape, size: LEVEL_SIZE[k] ?? 22 } };
    });
    const edges = kg.rels
      .filter((r) => set.has(r.start) && set.has(r.end) && !hideTypes.includes(r.type))
      .map((r) => ({ data: { id: `r${r.id}`, source: r.start, target: r.end, type: r.type } }));
    const showEdgeLabels = edgeLabels ?? nodes.length <= 45;
    const ink = cssVar("--ink"), ink2 = cssVar("--ink-2"), muted = cssVar("--muted"), axis = cssVar("--axis"), surface = cssVar("--surface"), accent = cssVar("--accent");

    cy.current = cytoscape({
      container: el.current,
      elements: [...nodes, ...edges],
      minZoom: 0.15,
      maxZoom: 3,
      style: [
        { selector: "node", style: {
          "background-color": "data(color)", shape: "data(shape)", width: "data(size)", height: "data(size)",
          label: "data(label)", "font-size": 10, color: ink2, "text-valign": "bottom", "text-margin-y": 4,
          "text-background-color": surface, "text-background-opacity": 0.8, "text-background-padding": 1,
          "border-width": 2, "border-color": surface, "text-wrap": "ellipsis", "text-max-width": 120,
        } },
        { selector: "edge", style: {
          width: 1.2, "line-color": axis, "target-arrow-color": axis, "target-arrow-shape": "triangle",
          "arrow-scale": 0.7, "curve-style": "bezier",
          label: showEdgeLabels ? "data(type)" : "", "font-size": 7, color: muted,
          "text-rotation": "autorotate", "text-background-color": surface, "text-background-opacity": 0.85, "text-background-padding": 1,
        } },
        { selector: ".faded", style: { opacity: 0.18 } },
        { selector: "node.sel", style: { "border-color": accent, "border-width": 4, color: ink, "font-weight": 700, "z-index": 10 } },
        { selector: "edge.hl", style: { "line-color": accent, "target-arrow-color": accent, width: 2, label: "data(type)", color: ink2, "z-index": 9 } },
      ],
      layout: LAYOUTS[layout] || LAYOUTS.fcose,
    });
    // Small graphs: don't blow nodes up to fill the canvas.
    if (cy.current.zoom() > 1.3) { cy.current.zoom(1.3); cy.current.center(); }
    cy.current.on("tap", "node", (e) => onSelectRef.current?.(e.target.id()));
    cy.current.on("tap", (e) => { if (e.target === cy.current) onSelectRef.current?.(null); });
    return () => cy.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, keys, layout, theme, edgeLabels, hideTypes.join()]);

  useEffect(() => {
    const c = cy.current;
    if (!c) return;
    c.elements().removeClass("sel hl faded");
    if (!selected) return;
    const n = c.getElementById(selected);
    if (!n.nonempty()) return;
    const hood = n.closedNeighborhood();
    c.elements().not(hood).addClass("faded");
    n.addClass("sel");
    n.connectedEdges().addClass("hl");
  }, [selected, keys, layout, theme]);

  useEffect(() => {
    const c = cy.current;
    if (!c || !fitKey) return;
    const n = c.getElementById(fitKey);
    if (n.nonempty()) c.animate({ center: { eles: n }, zoom: Math.max(c.zoom(), 1) }, { duration: 300 });
  }, [fitKey]);

  return (
    <>
      <div className="canvas" ref={el} role="img" aria-label="Knowledge graph view" />
      <div className="canvas-toolbar">
        <button className="btn small" onClick={() => cy.current?.fit(undefined, 30)}>Fit</button>
        <button className="btn small" onClick={() => {
          const png = cy.current?.png({ full: true, scale: 2, bg: cssVar("--surface") });
          if (png) { const a = document.createElement("a"); a.href = png; a.download = "knowledge-graph.png"; a.click(); }
        }}>PNG</button>
      </div>
    </>
  );
}
