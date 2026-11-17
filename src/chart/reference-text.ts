// The Vega-Lite reference for the model (DATA-16), on a budget of about 1,000 tokens. It is in
// context only while make_chart is in use; agent-loop decides when, from `chartToolReference`.

export const chartReferenceText = `## make_chart reference (Vega-Lite)
Write JavaScript that builds a Vega-Lite spec and ends with render(spec, data("rN")).
- data("rN") returns the rows of a stored result. Use the handle from query_sql.
- Aggregate first: query_sql with GROUP BY, then chart the small result. Large row sets are refused.
- Do not set colours, fonts, sizes of text, background, or config. The user's theme does that.
- Do not put "data" or "url" in the spec. Rows are attached by render.
- "field" must be a column name exactly as in the rows (case matters).
- "type" is one of "quantitative" (numbers), "temporal" (dates), "nominal" (categories), "ordinal" (ordered categories).
- Give every chart a short "title".
- Helpers are synchronous: no await.

Bar chart:
const spec = {
  title: "Revenue by region",
  mark: "bar",
  encoding: {
    x: { field: "region", type: "nominal", sort: "-y" },
    y: { field: "revenue", type: "quantitative", title: "Revenue" }
  }
};
render(spec, data("r4"));

Line chart over time:
render({
  title: "Monthly orders",
  mark: { type: "line", point: true },
  encoding: {
    x: { field: "month", type: "temporal", timeUnit: "yearmonth" },
    y: { field: "orders", type: "quantitative" }
  }
}, data("r5"));

Several lines: add color: { field: "product", type: "nominal" } to the encoding.

Stacked bar (one row per category and group):
render({
  title: "Headcount by department and level",
  mark: "bar",
  encoding: {
    x: { field: "department", type: "nominal" },
    y: { field: "headcount", type: "quantitative", stack: "zero" },
    color: { field: "level", type: "nominal" }
  }
}, data("r6"));

Horizontal bar: swap x and y. Grouped bars: add xOffset: { field: "level", type: "nominal" }.

Pie chart:
render({
  title: "Share of spend",
  mark: { type: "arc", innerRadius: 0 },
  encoding: {
    theta: { field: "amount", type: "quantitative" },
    color: { field: "category", type: "nominal" }
  }
}, data("r7"));

Reshape rows in JavaScript before render if needed:
const rows = data("r8").map(r => ({ ...r, margin: r.profit / r.revenue }));
render({ title: "Margin", mark: "bar", encoding: {
  x: { field: "store", type: "nominal" },
  y: { field: "margin", type: "quantitative", axis: { format: "%" } } } }, rows);

Common mistakes:
- "type": "quant" or "category": use the four names above.
- "mark": "bars" or "pie": use "bar" or "arc".
- Putting rows in spec.data.values: pass them to render instead.
- Calling render twice: build one spec, call render once.
- A field that is not a column: check the column names in the query result.
If make_chart returns an error, fix exactly what it names and call make_chart again.
`;

/**
 * The shape agent-loop's ToolReference expects. Agent-loop types it at integration, since
 * wave 1 parts cannot import each other.
 */
export const chartToolReference = {
  toolName: "make_chart",
  text: chartReferenceText,
  triggerWords: [
    "chart",
    "plot",
    "graph",
    "bar",
    "line",
    "pie",
    "visualize",
    "visualise",
    "diagram",
  ],
};
