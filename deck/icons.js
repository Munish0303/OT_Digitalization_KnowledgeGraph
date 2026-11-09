// Minimal hand-drawn line icons (24x24 viewBox), returned as base64 SVG for pptxgenjs.
const P = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>',
  alert: '<path d="M12 3 L22 20 H2 Z"/><line x1="12" y1="9" x2="12" y2="14"/><circle cx="12" cy="17" r="0.6"/>',
  wrench: '<path d="M14.5 3.5a5 5 0 0 0-4.6 6.9L3.5 16.8a2 2 0 0 0 2.8 2.8l6.4-6.4a5 5 0 0 0 6.9-4.6l-2.9 2.9-2.8-.6-.6-2.8z"/>',
  factory: '<path d="M2 21V10l6 4V10l6 4V6h3l1 15z"/><line x1="2" y1="21" x2="22" y2="21"/>',
  shield: '<path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z"/><path d="M8.5 12 L11 14.5 L15.5 9.5"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="2.8"/><path d="M4 5v14c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V5"/><path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8"/>',
  graph: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="12" cy="10" r="1.8"/><line x1="7" y1="7.5" x2="10.5" y2="9.3"/><line x1="17" y1="7.5" x2="13.5" y2="9.3"/><line x1="12" y1="11.8" x2="12" y2="15.5"/>',
  flask: '<path d="M9 2h6M10 2v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2"/><line x1="7" y1="15" x2="17" y2="15"/>',
  tube: '<path d="M8 2h8M9.5 2v15.5a2.5 2.5 0 0 0 5 0V2"/><line x1="9.5" y1="11" x2="14.5" y2="11"/><line x1="16" y1="15" x2="20" y2="15"/><line x1="16" y1="19" x2="19" y2="19"/>',
  chart: '<line x1="3" y1="21" x2="21" y2="21"/><rect x="5" y="12" width="3" height="9"/><rect x="10.5" y="7" width="3" height="14"/><rect x="16" y="3" width="3" height="18"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  layers: '<path d="M12 3 L22 8 L12 13 L2 8 Z"/><path d="M2 12 L12 17 L22 12"/><path d="M2 16 L12 21 L22 16"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="11" rx="1.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  route: '<circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="5" r="2.5"/><path d="M7.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.2-6 6.5-6s6 2.5 6.5 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14c3 0 5 2 5.5 5"/>',
};

function icon(name, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256" fill="none" ` +
    `stroke="#${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name]}</svg>`;
  return "image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

module.exports = { icon };
