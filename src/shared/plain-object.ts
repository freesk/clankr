// One definition of "a JSON object, not an array or null", shared by the chart spec walker,
// the browser's font replacement, and the agent loop's lenient argument parser.

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
