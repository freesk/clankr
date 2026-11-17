// Guidance for reading data questions, loaded into the system prompt only while query_sql is
// offered and the user's message has a trigger word (agent-loop's ToolReference rules), so it
// costs nothing on other requests. Concrete SQL, because the small model follows worked
// examples far more reliably than advice: in live runs it read "average nightly occupancy per
// city" as an average per shelter, and "by month of the fiscal year" as January to December.

export const dataQuestionText = `## Reading data questions
- An average "per city per night" (or per region per day) when rows are finer (one per shelter per night): total per city and night first, then average those totals. Say in the answer which reading you used.
  SELECT city, year, AVG(night_total) AS avg_nightly FROM (SELECT city, year, date, SUM(occupancy) AS night_total FROM t GROUP BY city, year, date) GROUP BY city, year
- Fiscal years: unless the data or the user says otherwise, Canadian and Alberta government fiscal years run April 1 to March 31 (fiscal 2024-25 is 2024-04-01 to 2025-03-31). "By month of the fiscal year" starts in April; name the months:
  SELECT strftime(paid_on, '%b') AS month, SUM(amount) AS total FROM t GROUP BY 1, month(paid_on) ORDER BY (month(paid_on) + 8) % 12
`;

/** The shape agent-loop's ToolReference expects (see src/chart/reference-text.ts). */
export const dataQuestionReference = {
  toolName: "query_sql",
  text: dataQuestionText,
  triggerWords: [
    "average",
    "avg",
    "mean",
    "per ",
    "nightly",
    "daily",
    "weekly",
    "monthly",
    "fiscal",
    "financial year",
  ],
};
