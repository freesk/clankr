import { describe, expect, it, vi } from "vitest";
import { SdkTokenCounter, toSdkHistory, toWebSocketUrl } from "./token-counter.ts";
import { LmStudioTransport } from "./transport.ts";

describe("toSdkHistory", () => {
  it("maps every role, keeps tool calls structured, and leaves images out", () => {
    const history = toSdkHistory([
      { role: "system", content: "S" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", mimeType: "image/png", dataBase64: "AAAA" },
        ],
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", argumentsJson: '{"path":"a"}' }],
      },
      { role: "tool", toolCallId: "c1", content: "text" },
    ]);
    expect(history.messages).toEqual([
      { role: "system", content: [{ type: "text", text: "S" }] },
      { role: "user", content: [{ type: "text", text: "look" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          {
            type: "toolCallRequest",
            toolCallRequest: {
              type: "function",
              id: "c1",
              name: "read_file",
              arguments: { path: "a" },
            },
          },
        ],
      },
      { role: "tool", content: [{ type: "toolCallResult", toolCallId: "c1", content: "text" }] },
    ]);
  });
});

describe("SdkTokenCounter", () => {
  it("connects over WebSocket to the same host", () => {
    expect(toWebSocketUrl("http://localhost:1234")).toBe("ws://localhost:1234");
    expect(toWebSocketUrl("https://127.0.0.1:8443/")).toBe("wss://127.0.0.1:8443");
  });

  it("refuses a non-loopback host before the SDK connects (SEC-1)", async () => {
    const resolveHost = vi.fn(async () => ["10.1.2.3"]);
    const transport = new LmStudioTransport({
      baseUrl: "http://lmstudio.example:1234",
      allowNonLoopbackHost: false,
      resolveHost,
    });
    const counter = new SdkTokenCounter(transport);
    await expect(counter.count([], "any")).rejects.toMatchObject({ kind: "host-not-allowed" });
    await counter.dispose();
  });
});
