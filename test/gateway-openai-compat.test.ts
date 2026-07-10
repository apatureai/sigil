import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatGateway, GatewayError } from "../src/gateway-openai-compat.js";
import type { GatewayRequest } from "../src/gateway.js";

const KEY = "sk-clientkey1234567890abcdef";
const BASE = "https://litellm.internal.client-vpc";

const request: GatewayRequest = {
  model: "candidate-a",
  taskId: "task_01",
  trial: 0,
  input: "Summarize the attached policy.",
};

function jsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function gatewayWith(fetchImpl: typeof fetch, over: Partial<Parameters<typeof createOpenAiCompatGateway>[0]> = {}) {
  let t = 0;
  return createOpenAiCompatGateway({
    baseUrl: BASE,
    allowedHosts: ["litellm.internal.client-vpc"],
    getApiKey: () => KEY,
    fetchImpl,
    nowMs: () => (t += 25),
    ...over,
  });
}

describe("createOpenAiCompatGateway (#1 production adapter)", () => {
  it("POSTs an OpenAI-compatible chat completion with the client's key and maps the response", async () => {
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("candidate-a");
      expect(body.messages).toEqual([{ role: "user", content: "Summarize the attached policy." }]);
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
      return jsonResponse({
        choices: [{ message: { content: "The policy says X." } }],
        usage: { cost: 0.00042 },
      });
    }) as unknown as typeof fetch;

    const result = await gatewayWith(fetchImpl).run(request);
    expect(result).toEqual({ output: "The policy says X.", costUsd: 0.00042, latencyMs: 25 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calledUrl = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as URL;
    expect(String(calledUrl)).toBe(`${BASE}/chat/completions`);
  });

  it("reads LiteLLM's cost header when the body carries no usage.cost", async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        { choices: [{ message: { content: "ok" } }] },
        { "x-litellm-response-cost": "0.0013" },
      )) as unknown as typeof fetch;
    const result = await gatewayWith(fetchImpl).run(request);
    expect(result.costUsd).toBe(0.0013);
  });

  it("refuses a host outside the egress allowlist BEFORE any network call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const gateway = gatewayWith(fetchImpl, { allowedHosts: ["some-other-host.internal"] });
    await expect(gateway.run(request)).rejects.toMatchObject({
      name: "GatewayError",
      code: "host_not_allowlisted",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the endpoint reports no cost (never fabricates $0)", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] })) as unknown as typeof fetch;
    await expect(gatewayWith(fetchImpl).run(request)).rejects.toMatchObject({
      code: "cost_unavailable",
    });
  });

  it("fails closed on HTTP errors with status only (no response body in the error)", async () => {
    const fetchImpl = (async () =>
      new Response(`upstream error echoing prompt: ${request.input}`, { status: 502 })) as unknown as typeof fetch;
    const err = await gatewayWith(fetchImpl)
      .run(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe("http_error");
    expect((err as GatewayError).message).not.toContain(request.input);
  });

  it("fails closed on a response without message content", async () => {
    const fetchImpl = (async () => jsonResponse({ choices: [{}], usage: { cost: 0.1 } })) as unknown as typeof fetch;
    await expect(gatewayWith(fetchImpl).run(request)).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it("scrubs the client key from transport-level errors", async () => {
    const fetchImpl = (async () => {
      throw new Error(`connect failed sending Bearer ${KEY}`);
    }) as unknown as typeof fetch;
    const err = await gatewayWith(fetchImpl)
      .run(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).message).not.toContain(KEY);
    expect((err as GatewayError).message).toContain("[redacted]");
  });
});
