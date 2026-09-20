import { describe, expect, it } from "vitest";
import { readJsonStream } from "../../src/server/openai-stream.js";

const event = (value: unknown) => `data:${JSON.stringify(value)}\r\n\r\n`;
const delta = (text: string) => event({ choices: [{ index: 0, delta: { content: text } }] });
const finish = event({ choices: [{ index: 0, delta: {}, finish_reason: "end_turn" }] });

function response(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("OpenAI-compatible JSON event streams", () => {
  it("assembles fragmented UTF-8 deltas and stops at the terminal marker", async () => {
    const stream = response(
      `: heartbeat\r\n\r\n${delta('{"answer":"')}${delta('상태 전이"}')}${finish}` +
        `data:[DONE]\r\n\r\n${event({ error: { message: "post-terminal gateway noise" } })}`,
    );
    expect(await readJsonStream(stream)).toEqual({ value: { answer: "상태 전이" }, usage: null });
  });

  it("rejects an error before completion instead of accepting partial output", async () => {
    const stream = response(
      `${delta('{"ok":true}')}${event({ error: { message: "failed" } })}${finish}data:[DONE]\n\n`,
    );
    await expect(readJsonStream(stream)).rejects.toMatchObject({ code: "provider_stream_error" });
  });

  it("rejects a stream without its completion marker", async () => {
    await expect(readJsonStream(response(delta('{"ok":true}') + finish))).rejects.toMatchObject({
      code: "provider_incomplete_stream",
    });
  });

  it("rejects output cut off by a token limit", async () => {
    const stream = response(
      delta('{"ok":true}') +
        event({ choices: [{ delta: {}, finish_reason: "length" }] }) +
        "data:[DONE]\n\n",
    );
    await expect(readJsonStream(stream)).rejects.toMatchObject({
      code: "provider_truncated_output",
    });
  });

  it("rejects prose or fenced code instead of silently repairing model output", async () => {
    await expect(
      readJsonStream(response(`${delta('```json\n{"ok":true}\n```')}${finish}data:[DONE]\n\n`)),
    ).rejects.toMatchObject({ code: "provider_invalid_json" });
  });

  it("preserves reported token usage when provided", async () => {
    const stream = response(
      delta('{"ok":true}') +
        finish +
        event({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } }) +
        "data:[DONE]\n\n",
    );
    expect(await readJsonStream(stream)).toEqual({
      value: { ok: true },
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
    });
  });

  it("accepts a single JSON code envelope only when explicitly enabled", async () => {
    const stream = response(`${delta('```json\n{"ok":true}\n```')}${finish}data:[DONE]\n\n`);
    expect(await readJsonStream(stream, "json-fence")).toEqual({
      value: { ok: true },
      usage: null,
    });
  });

  it.each([
    'Here is JSON: ```json\n{"ok":true}\n```',
    '```json\n{"ok":true}\n``` trailing text',
    '```json\n{"ok":true}\n```\n```json\n{"other":true}\n```',
    '```json\n{"ok":}\n```',
  ])("rejects a malformed or ambiguous envelope: %s", async (content) => {
    await expect(
      readJsonStream(response(`${delta(content)}${finish}data:[DONE]\n\n`), "json-fence"),
    ).rejects.toMatchObject({ code: "provider_invalid_json" });
  });
});
