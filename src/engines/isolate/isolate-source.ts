// JavaScript source that runs inside the isolate: the bootstrap that defines `console` and the
// helpers, and the wrapper around the model's code. Kept as strings in one place so the whole
// in-isolate surface can be reviewed at once (specs/sandbox.md: the helper list is the attack
// surface).
//
// Everything crosses the boundary as a JSON string, so no host object, function, or prototype is
// ever handed into the isolate by reference.

/** Script name that appears in stack traces of the model's code; error shaping looks for it. */
export const modelCodeFilename = "code.js";

/**
 * Runs once per isolate through `evalClosure`, with `$0` the log reference, `$1` the helper
 * dispatcher reference, and `$2` the JSON list of helper names. The references stay in this
 * closure, so the model's code cannot reach them.
 */
export const bootstrapSource = `
const logReference = $0;
const helperReference = $1;
const helperNames = JSON.parse($2);
const stringify = JSON.stringify;
const parse = JSON.parse;

function formatLogValue(value) {
  if (typeof value === "string") return value;
  try {
    const text = stringify(value);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

function writer(prefix) {
  return (...values) => {
    logReference.applySync(undefined, [prefix + values.map(formatLogValue).join(" ")]);
  };
}

globalThis.console = {
  log: writer(""),
  info: writer(""),
  debug: writer(""),
  warn: writer("warning: "),
  error: writer("error: "),
};

for (const name of helperNames) {
  globalThis[name] = (...args) => {
    const reply = parse(helperReference.applySyncPromise(undefined, [name, stringify(args)]));
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  };
}
`;

/**
 * Builds the script that runs the model's code and settles to a JSON outcome string:
 * `{ ok: true, value? }` or `{ ok: false, message, line? }`. The model's first line is line 2 of
 * the script, so it is compiled with a line offset of -1 and stack traces use the model's numbers.
 *
 * As an expression, the code's value is returned, so `data("r1").length` works without `return`.
 */
export function wrapModelCode(code: string, form: "expression" | "statements"): string {
  const open = form === "expression" ? "return (" : "";
  const close = form === "expression" ? ");" : "";
  return `(function (stringify, modelCodeFilename) { const run = async function () { ${open}
${code}
${close} };
${settleSource}
})(JSON.stringify, ${JSON.stringify(modelCodeFilename)})`;
}

// Turns the model's result or error into the outcome string. Uses `stringify` captured before the
// model's code ran, so code that replaces `JSON` cannot change what reaches the host.
const settleSource = `
function lineOf(stack) {
  const match = new RegExp(modelCodeFilename + ":(\\\\d+)").exec(String(stack));
  return match ? Number(match[1]) : undefined;
}
function describe(error) {
  try {
    if (error instanceof Error) {
      return { message: String(error.name) + ": " + String(error.message), line: lineOf(error.stack) };
    }
    return { message: "Uncaught " + String(error) };
  } catch {
    return { message: "Uncaught error that cannot be described" };
  }
}
return run().then(
  (value) => {
    try {
      return stringify({ ok: true, value });
    } catch (error) {
      return stringify({ ok: false, message: "The returned value cannot be turned into JSON: " + describe(error).message });
    }
  },
  (error) => stringify({ ok: false, ...describe(error) }),
);`;
