import { execFile } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ChatMessage,
  ChatRequest,
  LoadedModel,
  ToolContext,
  UserContentPart,
} from "../../contracts/index.ts";
import {
  createTestToolContext,
  FixedPathPolicy,
  respond,
  ScriptedLmClient,
} from "../../testing/index.ts";
import { viewImageTool } from "./view-image-tool.ts";

const runFile = promisify(execFile);

const visionModel: LoadedModel = {
  key: "test/vision-model",
  instanceId: "test/vision-model:1",
  contextLength: 16_384,
  capabilities: { vision: true, trainedForToolUse: true, reasoning: true },
};

let cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups) await cleanup();
  cleanups = [];
});

async function setUp(overrides: Partial<ToolContext> = {}) {
  const lm = new ScriptedLmClient([respond.text("A receipt from a coffee shop.")]);
  const { context, cleanup } = await createTestToolContext({
    lm,
    model: visionModel,
    ...overrides,
  });
  cleanups.push(cleanup);
  return { lm, context };
}

/** A solid-colour image generated in code, so no binary fixtures are committed. */
function blankImage(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: "#d04020" } });
}

async function writeImage(
  context: ToolContext,
  name: string,
  encoded: Promise<Buffer>,
): Promise<string> {
  const path = join(context.workingDirectory, name);
  await writeFile(path, await encoded);
  return path;
}

function run(args: Record<string, unknown>, context: ToolContext) {
  return viewImageTool.run(viewImageTool.parameters.parse(args), context);
}

function sentImage(request: ChatRequest | undefined): Extract<UserContentPart, { type: "image" }> {
  const user = request?.messages.find((message) => message.role === "user");
  const parts = typeof user?.content === "string" ? [] : (user?.content ?? []);
  const image = parts.find((part) => part.type === "image");
  if (image?.type !== "image") throw new Error("No image in the request");
  return image;
}

async function sentMetadata(request: ChatRequest | undefined) {
  return sharp(Buffer.from(sentImage(request).dataBase64, "base64")).metadata();
}

describe("view_image", () => {
  it("sends the image in a separate request and returns only text", async () => {
    const { lm, context } = await setUp();
    const path = await writeImage(context, "receipt.png", blankImage(200, 100).png().toBuffer());
    const session: ChatMessage[] = [{ role: "user", content: "What does this receipt say?" }];

    const output = await run({ path, question: "What shop is this from?" }, context);
    session.push({ role: "tool", toolCallId: "call_1", content: output.text });

    const request = lm.requests[0];
    expect(lm.requests).toHaveLength(1);
    expect(request?.tools).toBeUndefined();
    expect(request?.model).toBe(visionModel.instanceId);
    expect(request?.maxTokens).toBe(context.config.image.answerTokens);
    expect(request?.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(output.text).toContain("A receipt from a coffee shop.");
    expect(output.text).not.toContain(sentImage(request).dataBase64.slice(0, 40));
    for (const message of session) expect(typeof message.content).toBe("string");
  });

  it("downscales a large image to the configured edge, keeping the aspect ratio", async () => {
    const { lm, context } = await setUp();
    const path = await writeImage(context, "large.png", blankImage(3000, 1500).png().toBuffer());

    const output = await run({ path }, context);

    const sent = await sentMetadata(lm.requests[0]);
    expect([sent.width, sent.height]).toEqual([1024, 512]);
    expect(output.text).toContain("3000x1500, sent at 1024x512");
  });

  it("leaves a small image at its own size", async () => {
    const { lm, context } = await setUp();
    const path = await writeImage(context, "small.png", blankImage(300, 200).png().toBuffer());

    await run({ path }, context);

    const sent = await sentMetadata(lm.requests[0]);
    expect([sent.width, sent.height]).toEqual([300, 200]);
  });

  it("applies the orientation tag and strips metadata before sending", async () => {
    const { lm, context } = await setUp();
    const tagged = blankImage(400, 200)
      .withExif({ IFD0: { Copyright: "private" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const path = await writeImage(context, "tagged.jpg", tagged);

    await run({ path }, context);

    const sent = await sentMetadata(lm.requests[0]);
    expect([sent.width, sent.height]).toEqual([200, 400]);
    expect(sent.exif).toBeUndefined();
    expect(sent.orientation).toBeUndefined();
  });

  it("identifies the format by content, not by extension", async () => {
    const { lm, context } = await setUp();
    lm.enqueue(respond.text("second"));
    const pngNamedJpg = await writeImage(context, "photo.jpg", blankImage(10, 10).png().toBuffer());
    const jpegNamedPng = await writeImage(
      context,
      "photo.png",
      blankImage(10, 10).jpeg().toBuffer(),
    );

    await run({ path: pngNamedJpg }, context);
    await run({ path: jpegNamedPng }, context);

    expect(sentImage(lm.requests[0]).mimeType).toBe("image/png");
    expect(sentImage(lm.requests[1]).mimeType).toBe("image/jpeg");
  });

  it("refuses a denied path without calling the model", async () => {
    const { context: base } = await setUp();
    const deniedFolder = join(base.workingDirectory, "secrets");
    const lm = new ScriptedLmClient();
    const paths = new FixedPathPolicy({
      allowedRoots: [base.workingDirectory],
      deniedPaths: [deniedFolder],
    });
    const context = { ...base, lm, paths };

    await expect(run({ path: join(deniedFolder, "key.png") }, context)).rejects.toThrow(
      /protected list/,
    );
    expect(lm.requests).toHaveLength(0);
  });

  it("says what a non-image is and which tool reads it", async () => {
    const { lm, context } = await setUp();
    const path = join(context.workingDirectory, "notes.png");
    await writeFile(path, "These are notes, not pixels.\n");

    await expect(run({ path }, context)).rejects.toThrow(
      /a text file, not an image\. Use read_file/,
    );
    expect(lm.requests).toHaveLength(0);
  });

  it("names the supported formats for unknown binary content", async () => {
    const { context } = await setUp();
    const path = join(context.workingDirectory, "mystery.png");
    await writeFile(path, Buffer.from([0, 1, 2, 3, 254, 0, 9, 9]));

    await expect(run({ path }, context)).rejects.toThrow(/Supported: JPEG, PNG, WebP/);
  });

  it("transcribes with reasoning off and a larger answer allowance", async () => {
    const { lm, context } = await setUp({ reasoning: "on" });
    const path = await writeImage(context, "scan.png", blankImage(50, 50).png().toBuffer());

    await run({ path, mode: "transcribe" }, context);

    const request = lm.requests[0];
    expect(request?.reasoning).toBe("off");
    expect(request?.maxTokens).toBe(context.config.image.transcribeAnswerTokens);
    expect(request?.messages[0]?.content).toContain("Transcribe all text");
  });

  it("follows the session's reasoning setting for questions", async () => {
    const { lm, context } = await setUp({ reasoning: "on" });
    const path = await writeImage(context, "chart.png", blankImage(50, 50).png().toBuffer());

    await run({ path, question: "Is the line rising?" }, context);

    expect(lm.requests[0]?.reasoning).toBe("on");
  });

  it("notes when the answer was cut off", async () => {
    const lm = new ScriptedLmClient([
      [
        { type: "text", delta: "Line one" },
        { type: "done", finishReason: "length" },
      ],
    ]);
    const { context } = await setUp({ lm });
    const path = await writeImage(context, "long.png", blankImage(50, 50).png().toBuffer());

    const output = await run({ path, mode: "transcribe" }, context);

    expect(output.text).toContain("Line one");
    expect(output.text).toContain("cut off");
  });

  it("refuses when no vision model is loaded", async () => {
    const textOnly = {
      ...visionModel,
      capabilities: { ...visionModel.capabilities, vision: false },
    };
    const { context } = await setUp({ model: textOnly });
    const path = await writeImage(context, "a.png", blankImage(10, 10).png().toBuffer());

    await expect(run({ path }, context)).rejects.toThrow(/cannot see images/);
  });

  it("decodes GIF with sharp and sends PNG", async () => {
    const { lm, context } = await setUp();
    const path = await writeImage(context, "anim.gif", blankImage(40, 30).gif().toBuffer());

    await run({ path }, context);

    expect(sentImage(lm.requests[0]).mimeType).toBe("image/png");
  });

  it.each(["heic", "bmp"])(
    "converts %s with sips and cleans up the scratch file",
    async (format) => {
      const { lm, context } = await setUp();
      const source = await writeImage(context, "source.png", blankImage(64, 48).png().toBuffer());
      const path = join(context.workingDirectory, `converted.${format}`);
      await runFile("/usr/bin/sips", ["-s", "format", format, source, "--out", path]);

      await run({ path }, context);

      const sent = await sentMetadata(lm.requests[0]);
      expect(sentImage(lm.requests[0]).mimeType).toBe("image/png");
      expect([sent.width, sent.height]).toEqual([64, 48]);
      expect(await readdir(context.clankrPaths.session.scratch)).toEqual([]);
    },
  );
});
