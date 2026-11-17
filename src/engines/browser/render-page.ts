// The render page and the only files it may load (DATA-12): the vendored Vega builds and the
// page's own fixed bootstrap. Everything is served from memory or from vendor/ by the request
// guard in offline.ts.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServedFile, ServedFileLookup } from "./offline.ts";
import { pageBootstrapScript, vegaUtilShimScript } from "./page-script.ts";
import { assertVendored, vegaBrowserFiles, vegaDirectory } from "./vendor-files.ts";

export const renderPagePath = "/render.html";

/**
 * No 'unsafe-eval': nothing in the page can turn a string into code, so even a hostile spec
 * cannot become script. Inline styles are allowed because Vega's SVG output uses them.
 */
export const renderPageContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join("; ");

const renderPageHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/page/style.css">
<script src="/vendor/vega.min.js"></script>
<script src="/vendor/vega-lite.min.js"></script>
<script type="module" src="/page/bootstrap.js"></script>
</head>
<body><main id="content"></main></body>
</html>
`;

const renderPageStyle = `
html, body { margin: 0; padding: 0; background: white; }
.chart { break-inside: avoid; page-break-inside: avoid; margin: 0 0 16px 0; }
.chart svg { display: block; max-width: 100%; height: auto; }
.text-block { break-after: avoid; margin: 0 0 12px 0; }
h1.text-block { font-size: 20px; }
p.text-block { font-size: 12px; line-height: 1.45; white-space: pre-wrap; }
.chart-page + .chart-page { break-before: page; page-break-before: always; }
.chart-page .chart { margin-bottom: 8px; }
p.summary { font-size: 13px; line-height: 1.45; margin: 0; color: #222; white-space: normal; }
`;

const javascript = "text/javascript; charset=utf-8";

const inMemoryFiles: Record<string, ServedFile> = {
  [renderPagePath]: {
    contentType: "text/html; charset=utf-8",
    body: renderPageHtml,
    headers: { "Content-Security-Policy": renderPageContentSecurityPolicy },
  },
  "/page/style.css": { contentType: "text/css; charset=utf-8", body: renderPageStyle },
  "/page/bootstrap.js": { contentType: javascript, body: pageBootstrapScript },
  "/page/vega-util.js": { contentType: javascript, body: vegaUtilShimScript },
};

/** The interpreter is an ES module that imports the bare name "vega-util", which a page cannot resolve. */
function pointInterpreterAtShim(source: string): string {
  return source.replaceAll(/from\s+['"]vega-util['"]/g, 'from "/page/vega-util.js"');
}

async function readVendoredScript(fileName: string): Promise<ServedFile> {
  const path = join(vegaDirectory, fileName);
  assertVendored([path]);
  const source = await readFile(path, "utf8");
  const body = fileName === "vega-interpreter.js" ? pointInterpreterAtShim(source) : source;
  return { contentType: javascript, body };
}

/** Builds the lookup the request guard serves from. Vendored scripts are read once and kept. */
export function createRenderPageFiles(): ServedFileLookup {
  const vendoredCache = new Map<string, Promise<ServedFile>>();
  return async (path) => {
    const inMemory = inMemoryFiles[path];
    if (inMemory) return inMemory;
    const fileName = path.startsWith("/vendor/") ? path.slice("/vendor/".length) : undefined;
    if (!fileName || !vegaBrowserFiles.includes(fileName)) return undefined;
    let cached = vendoredCache.get(fileName);
    if (!cached) {
      cached = readVendoredScript(fileName);
      vendoredCache.set(fileName, cached);
    }
    return cached;
  };
}
