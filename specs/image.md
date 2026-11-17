# Image reading

| | |
|---|---|
| **Wave** | 1 |
| **Milestone** | M3 |
| **Owns** | `src/tools/image/` |

## Purpose

Let the model look at a local image and answer a question about it (scenario S6) without the image's tokens ever sitting in the conversation. The image is sent in a separate model call; only the text answer comes back.

## Requirements

- IMG-1: `view_image`.
- IMG-2: downscaling to a configurable maximum edge.
- IMG-3: the isolated sub-call.
- IMG-4, IMG-5: format conversion, transcribe mode.
- IMG-6, IMG-7: crop and zoom, PDF pages as images.
- PRD section 7.2, technique 4.

## Provides

One `ToolDefinition`, `view_image`, in the `vision` group with `read` permission.

## Consumes

| Contract | From | Fake until it exists |
|---|---|---|
| `LmClient.chat` with image content | lmstudio | Scripted `LmClient` that records the request |
| `PathPolicy` | permissions | Fake with a fixed deny list |
| `Config` (maximum edge) | foundation | Real |

Whether the tool is offered at all depends on the model's vision capability. That gate is in [agent-loop](agent-loop.md); this part only tags the tool with the `vision` group.

## Design notes

- **The sub-call is a single model request**, not a sub-agent. It contains a short instruction, the question, and the image. It has no tools and no conversation history.
- **Only text returns.** The answer is the tool result and is capped like any other. The image bytes are never appended to the session's messages.
- **Budget the sub-call.** An image costs tokens too. Pick the downscale size so the image, the question, and room for the answer fit in the loaded context length.
- **Downscale, never upscale.** Keep the aspect ratio. Strip metadata such as location data before sending; the model does not need it.
- **Detect the format from the file's content**, not its extension.
- **`sharp` is loaded lazily**, on the first call, to protect startup time.
- **`sips` is the conversion fallback.** It ships with macOS and works offline. Start it with an argument array, never through a shell, and write its output into the session's scratch directory.
- **Transcribe mode (IMG-5)** is the same tool with a different instruction and a larger answer allowance, since transcribed text is longer than a description.
- **Errors point somewhere.** Not an image: say what it is and which tool reads it. Unsupported format: name the supported ones.

## Not in this part

- Capability gating (agent-loop).
- The chart self-check (DATA-18), which reuses this sub-call but is triggered by [chart](chart.md).
- Scanned PDFs as chart data sources, a PRD non-goal.

## Done when

- A test with the scripted `LmClient` shows the image request is separate from the session, and that no image content is in the session's messages afterwards.
- A large image is downscaled to the configured edge; a small one is left alone.
- A file with the wrong extension is identified by content.
- A denied path is refused.
- Against a vision-capable model in LM Studio, a fixture receipt is described and transcribed. If no downloaded model reports vision, this item is recorded as not verified, with the reason.

## Decisions

Settled 2026-11-17.

| Topic | Decision |
|---|---|
| Formats `sharp` cannot decode (IMG-4) | `sharp` is tried first. Anything it cannot read, HEIC in particular, is converted with the built-in macOS `sips` command. |
| Reasoning in the sub-call | Off for transcribe mode. Questions follow the session's `/think` setting. |

## Open questions

- What should the default maximum edge be? This is a measurement, not a choice: pick it from the target model's image token cost, measured in M3.
