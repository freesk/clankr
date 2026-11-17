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

function contentArea() {
  return document.getElementById("content");
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
  const viewId = nextViewId++;
  views.set(viewId, view);
  return { viewId, warnings };
}

function addText(kind, text) {
  const element = document.createElement(kind === "heading" ? "h1" : "p");
  element.className = "text-block";
  element.textContent = text;
  contentArea().append(element);
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

window.clankr = { renderChart, addText, exportPng, exportSvg, isFontInstalled };
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
