// Foundation "done when": a test in another part's directory imports a contract and a fake.
// The search part may delete this once it has real tests of its own.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type ToolDefinition, ToolError } from "../../contracts/index.ts";
import { createTestToolContext } from "../../testing/index.ts";

const echoParameters = z.object({ path: z.string() });

const echoTool: ToolDefinition<typeof echoParameters> = {
  name: "echo_path",
  description: "Echo a path after checking it with the path policy.",
  parameters: echoParameters,
  permission: "read",
  resultTokenCap: 100,
  groups: ["core"],
  keyArgument: "path",
  async run(args, context) {
    const { realPath, pathClass } = await context.paths.classify(args.path);
    if (pathClass === "denied")
      throw new ToolError(`${args.path} is protected. Choose another path.`);
    const handle = await context.results.putText(realPath, { tool: "echo_path", arguments: args });
    return { text: realPath, handles: [handle] };
  },
};

describe("contracts and fakes from a part directory", () => {
  it("runs a tool against a fake tool context", async () => {
    const { context, cleanup } = await createTestToolContext();
    try {
      const output = await echoTool.run(echoTool.parameters.parse({ path: "notes.md" }), context);
      expect(output.text).toBe(`${context.workingDirectory}/notes.md`);
      expect(output.handles).toEqual(["r1"]);
    } finally {
      await cleanup();
    }
  });
});
