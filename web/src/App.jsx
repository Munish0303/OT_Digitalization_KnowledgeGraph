import { useEffect, useState } from "react";
import { loadGraph } from "./kg.js";
import { href, setTheme, useRoute, useTheme } from "./ui.jsx";
import Story from "./views/Story.jsx";
import GraphExplorer from "./views/GraphExplorer.jsx";
import Traceability from "./views/Traceability.jsx";
import FaultAnalysis from "./views/FaultAnalysis.jsx";
import Maintenance from "./views/Maintenance.jsx";
import DataModel from "./views/DataModel.jsx";

const TABS = [
  { path: "story", name: "Overview", View: Story },
  { path: "graph", name: "Knowledge graph", View: GraphExplorer },
  { path: "trace", name: "Batch traceability", View: Traceability },
  { path: "fault", name: "Fault analysis", View: FaultAnalysis },
  { path: "maint", name: "Maintenance knowledge", View: Maintenance },
  { path: "model", name: "Data model", View: DataModel },
];

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const route = useRoute();
  const theme = useTheme();
  useEffect(() => { loadGraph().then(setData, (e) => setError(String(e))); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [route.path]);

  const tab = TABS.find((t) => t.path === route.path) || TABS[0];
  const View = tab.View;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M8 9L24 9L16 24Z" fill="none" stroke="var(--ink-2)" strokeWidth="2" />
              <circle cx="8" cy="9" r="5" fill="var(--s1)" /><circle cx="24" cy="9" r="5" fill="var(--s3)" /><circle cx="16" cy="24" r="5" fill="var(--s2)" />
            </svg>
            <div>
              <h1>Plant Knowledge Graph</h1>
              <div className="sub">ISA-88 · PC-01 Compounding</div>
            </div>
            <span className="badge-sim">Simulated data</span>
          </div>
          <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle colour theme">
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => (
              <a key={t.path} href={href(t.path)} className={t === tab ? "active" : ""} aria-current={t === tab ? "page" : undefined}>{t.name}</a>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {error && <div className="loading">Could not load the graph: {error}</div>}
        {!data && !error && <div className="loading">Loading knowledge graph…</div>}
        {data && <View kg={data.kg} meta={data.meta} params={route.params} />}
      </main>
      <footer className="footer">
        ISA-88 plant knowledge graph · interview concept prototype · all equipment, recipes, batches and lots are simulated.
      </footer>
    </>
  );
}
