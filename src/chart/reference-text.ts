// The Vega-Lite reference for the model (DATA-16), on a budget of about 1,000 tokens. It is in
// context only while make_chart is in use; agent-loop decides when, from `chartToolReference`.

export const chartReferenceText = `## make_chart reference (Vega-Lite)
Write JavaScript that builds a Vega-Lite spec and ends with render(spec, data("rN")).
- data("rN") returns the rows of a stored result. Use the handle from query_sql.
- Do the maths in query_sql, not JavaScript: totals (GROUP BY), shares, growth, and indexes to a base year (window functions), and new groupings (CASE WHEN). Then chart that result as it is.
- Counting things (licences, people, orders): COUNT(DISTINCT id_column). A file often has several rows per thing; the inspect_data profile shows each column's distinct count.
- Averages over time: when rows are finer than the question, total them first, then average. Rows per shelter per day, "average nightly occupancy per city and year":
  SELECT city, year, AVG(night) AS avg_nightly FROM (SELECT city, year, date, SUM(occupancy) AS night FROM t GROUP BY city, year, date) GROUP BY city, year
- Do not set colours, fonts, background, or config. The user's theme does that.
- Do not put "data" or "url" in the spec. Rows are attached by render.
- "field" must be a column of the rows, exactly (case matters).
- "type": "quantitative" (numbers), "temporal" (dates), "nominal" (categories), "ordinal" (ordered categories).
- Give every chart a short "title". Helpers are synchronous: no await.

Bar chart:
render({ title: "Revenue by region", mark: "bar", encoding: {
  x: { field: "region", type: "nominal", sort: "-y" },
  y: { field: "revenue", type: "quantitative", title: "Revenue" } } }, data("r4"));
Stacked: add color: { field: "level", type: "nominal" }. Grouped: also xOffset: { field: "level", type: "nominal" }. Horizontal, largest at the top: y: { field: "region", type: "nominal", sort: "-x" } and the number on x.
Pie: mark: "arc", encoding: { theta: { field: "amount", type: "quantitative" }, color: { field: "category", type: "nominal" } }.

Lines over time: mark: { type: "line", point: true }, x: { field: "month", type: "temporal" }, several lines with color: { field: "product", type: "nominal" }.

Index to a base year, grouped (query_sql):
SELECT place, year, CASE WHEN place IN ('A','B') THEN 'North' ELSE 'South' END AS area,
  100.0 * pop / FIRST_VALUE(pop) OVER (PARTITION BY place ORDER BY year) AS indexed
FROM (SELECT place, year, SUM(value) AS pop FROM t WHERE year BETWEEN 2001 AND 2025 GROUP BY place, year)
Then one small panel per group, labels at the line ends instead of a legend:
const line = { field: "place", type: "nominal", legend: null };
render({ title: "Population, 2001 = 100",
  facet: { column: { field: "area", type: "nominal", title: null } },
  spec: { layer: [
    { mark: "line", encoding: { x: { field: "year", type: "quantitative", title: null },
        y: { field: "indexed", type: "quantitative", title: "2001 = 100" }, color: line } },
    { transform: [{ joinaggregate: [{ op: "max", field: "year", as: "last" }], groupby: ["place"] },
        { filter: "datum.year === datum.last" }],
      mark: { type: "text", align: "left", dx: 4 },
      encoding: { x: { field: "year", type: "quantitative" }, y: { field: "indexed", type: "quantitative" },
        text: { field: "place" }, color: line } } ] } }, data("r9"));
With facet, put the views under "spec"; mark and encoding never sit beside "facet".

Common mistakes:
- "type": "quant" or "category": use the four names above. "mark": "bars" or "pie": use "bar" or "arc".
- Rows in spec.data.values, or render called twice: pass rows to render, once.
- A field that is not a column: add it in query_sql first.
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
