// The render page's own script, served as /page/bootstrap.js. It is fixed harness code: the
// spec and rows only ever arrive as arguments to these functions, never as script text
// (DATA-12). Vega runs in expression-interpreter mode with `ast: true`, so expressions in a
// spec are evaluated without generating code, and the page's content security policy
// forbids code generation anyway.

export const pageBootstrapScript = `
import { expressionInterpreter } from "/vendor/vega-interpreter.js";

const views = new Map();
let nextViewId = 1;

function collectingLogger(messages) {
  const record = (...parts) => { messages.push(parts.map(String).join(" ")); };
  const logger = {
    level() { return logger; },
    error: record,
    warn: record,
    info() { return logger; },
    debug() { return logger; },
  };
  return logger;
}

let currentPage = null;

// Charts and text go into the page section started last, or straight into the content.
function contentArea() {
  return currentPage ?? document.getElementById("content");
}

// A section that starts on a new printed page (see the stylesheet), for one chart and its summary.
function startPage() {
  currentPage = document.createElement("section");
  currentPage.className = "chart-page";
  document.getElementById("content").append(currentPage);
}

// Text blocks use the theme's font. The family arrives as data and is set through the CSSOM.
function setTextFont(family) {
  document.body.style.fontFamily = JSON.stringify(family) + ", sans-serif";
}

async function renderChart(spec, rows) {
  const warnings = [];
  const compiled = vegaLite.compile(spec, { logger: collectingLogger(warnings) }).spec;
  const runtime = vega.parse(compiled, null, { ast: true });
  const container = document.createElement("div");
  container.className = "chart";
  contentArea().append(container);
  const view = new vega.View(runtime, {
    expr: expressionInterpreter,
    renderer: "svg",
    container,
    hover: false,
    logger: collectingLogger(warnings),
  });
  // A spec whose views all name their own data leaves the harness's data set out.
  if ((compiled.data ?? []).some((dataset) => dataset.name === "table")) view.data("table", rows);
  await view.runAsync();
  await document.fonts.ready;
  if (separateOverlappingLabels(view.scenegraph().root)) view._renderer.render(view.scenegraph().root);
  const viewId = nextViewId++;
  views.set(viewId, view);
  return { viewId, warnings };
}

// Vega-Lite has no collision avoidance for text marks, so labels for close values (end-of-line
// labels such as 138 and 146) are drawn on top of each other. Labels in one text mark that sit
// in the same column are pushed apart vertically until each has a line to itself.
function separateOverlappingLabels(mark) {
  let moved = false;
  // Only the chart's own text marks: axis labels, titles, and legends are text marks too.
  if (mark.marktype === "text" && mark.role === "mark") moved = spreadLabels(mark.items ?? []);
  if (mark.marktype === "group") {
    for (const group of mark.items ?? []) {
      for (const child of group.items ?? []) moved = separateOverlappingLabels(child) || moved;
    }
  }
  return moved;
}

function spreadLabels(items) {
  const labels = items
    .filter((item) => item.text != null && item.text !== "" && Number.isFinite(item.y))
    .sort((a, b) => a.y - b.y);
  const sameColumn = (a, b) => Math.abs((a.x ?? 0) - (b.x ?? 0)) < 40;
  let moved = false;
  // A few passes settle clusters of three or more labels.
  for (let pass = 0; pass < 4; pass++) {
    for (let index = 1; index < labels.length; index++) {
      const above = labels[index - 1];
      const below = labels[index];
      if (!sameColumn(above, below)) continue;
      const lineHeight = Math.max(above.fontSize ?? 11, below.fontSize ?? 11) + 2;
      const overlap = lineHeight - (below.y - above.y);
      if (overlap <= 0) continue;
      above.y -= overlap / 2;
      below.y += overlap / 2;
      moved = true;
    }
  }
  return moved;
}

function addText(kind, text) {
  const element = document.createElement(kind === "heading" ? "h1" : "p");
  element.className = kind === "summary" ? "text-block summary" : "text-block";
  // textContent, never innerHTML: markup in the text is printed as characters.
  element.textContent = text;
  contentArea().append(element);
}

// A data table (export_table). Every cell arrives as a string and is set with textContent,
// so cell text is never read as markup. The header row repeats on each printed page.
function addTable(columns, rows, numericColumns) {
  const table = document.createElement("table");
  table.className = "data-table";
  const headerRow = table.createTHead().insertRow();
  for (const name of columns) {
    const cell = document.createElement("th");
    cell.textContent = name;
    headerRow.append(cell);
  }
  const body = table.createTBody();
  for (const cells of rows) {
    const row = body.insertRow();
    cells.forEach((text, index) => {
      const cell = row.insertCell();
      cell.textContent = text;
      if (numericColumns[index]) cell.className = "number";
    });
  }
  contentArea().append(table);
}

// For PDF: scales the last drawn chart to fill the printable area, up or down, keeping its
// proportions. The drawing is SVG, so scaling up loses no quality.
function fitLastChart(width, height) {
  const drawings = document.querySelectorAll(".chart svg");
  const svg = drawings[drawings.length - 1];
  if (!svg) return;
  const naturalWidth = Number(svg.getAttribute("width"));
  const naturalHeight = Number(svg.getAttribute("height"));
  if (!(naturalWidth > 0 && naturalHeight > 0)) return;
  if (!svg.getAttribute("viewBox")) {
    svg.setAttribute("viewBox", "0 0 " + naturalWidth + " " + naturalHeight);
  }
  const scale = Math.min(width / naturalWidth, height / naturalHeight, 2);
  svg.style.maxWidth = "none";
  svg.style.width = Math.floor(naturalWidth * scale) + "px";
  svg.style.height = Math.floor(naturalHeight * scale) + "px";
}

async function exportPng(viewId, scale) {
  const url = await views.get(viewId).toImageURL("png", scale);
  return url.slice(url.indexOf(",") + 1);
}

async function exportSvg(viewId) {
  return views.get(viewId).toSVG();
}

// A family is installed when text drawn in it measures differently from every generic fallback.
function isFontInstalled(family) {
  const context = document.createElement("canvas").getContext("2d");
  const sample = "mmmmmmmmmmlli1WQ@#";
  return ["monospace", "serif", "sans-serif"].some((fallback) => {
    context.font = "72px " + fallback;
    const fallbackWidth = context.measureText(sample).width;
    context.font = "72px " + JSON.stringify(family) + ", " + fallback;
    return context.measureText(sample).width !== fallbackWidth;
  });
}

window.clankr = {
  renderChart,
  addText,
  addTable,
  startPage,
  setTextFont,
  fitLastChart,
  exportPng,
  exportSvg,
  isFontInstalled,
};
// Requests the content security policy stops never reach the request guard, so the page
// reports them itself through a binding the guard installs.
document.addEventListener("securitypolicyviolation", (event) => {
  window.clankrReportBlocked?.(event.blockedURI || "(inline)", event.effectiveDirective);
});

window.clankrReady = true;
`;

/** The Vega expression interpreter imports three helpers from vega-util; the full Vega build has them. */
export const vegaUtilShimScript = `const { ascending, isString, DisallowedObjectProperties } = window.vega;
export { ascending, isString, DisallowedObjectProperties };
`;
