// Validates a spec against the vendored Vega-Lite JSON schema (DATA-11, D3). Ajv and the
// 2 MB schema are loaded on the first chart, not at startup, and compiled once.

import { readFile } from "node:fs/promises";
import { assertVendored, vegaLiteSchemaPath } from "../engines/browser/index.ts";
import { rewriteSchemaErrors, type SchemaError } from "./validation-messages.ts";

type Validator = ((data: unknown) => boolean) & { errors?: SchemaError[] | null };

type AjvConstructor = new (
  options: Record<string, unknown>,
) => { compile(schema: unknown): Validator };

let validatorPromise: Promise<Validator> | undefined;

async function compileValidator(): Promise<Validator> {
  assertVendored([vegaLiteSchemaPath]);
  const schema = JSON.parse(await readFile(vegaLiteSchemaPath, "utf8"));
  // Ajv is CommonJS: under ESM the module object is the class, with the class again on `default`.
  const ajvModule = (await import("ajv")) as unknown as { default: { default: AjvConstructor } };
  const Ajv = ajvModule.default.default;
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    // `verbose` gives each error its schema, which the rewriter needs to know accepted names.
    verbose: true,
    validateFormats: false,
  });
  return ajv.compile(schema) as unknown as Validator;
}

function validator(): Promise<Validator> {
  if (!validatorPromise) {
    validatorPromise = compileValidator();
    validatorPromise.catch(() => {
      validatorPromise = undefined;
    });
  }
  return validatorPromise;
}

/** Returns short, fixable messages, or an empty list when the spec is valid. */
export async function validateSpec(spec: Record<string, unknown>): Promise<string[]> {
  const validate = await validator();
  if (validate(spec)) return [];
  return rewriteSchemaErrors(validate.errors ?? [], spec);
}
