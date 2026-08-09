/**
 * Production Gateway adapter (TRD §4; methodology: TRD §2, step 2).
 *
 * Runs the candidate panel through an OpenAI-compatible chat-completions
 * endpoint — LiteLLM proxy and OpenRouter both speak this dialect — INSIDE the
 * client's VPC with the client's key. The boundary rules, enforced here rather
 * than promised:
 *
 * - **The harness never holds a key.** The adapter takes a key ACCESSOR,
 *   invoked per request; the key is never stored on the adapter, never logged,
 *   and scrubbed from every error this module can throw.
 * - **Egress allowlist at the network hop.** The adapter refuses to call any
 *   host not explicitly allowlisted by the client's run configuration — the
 *   panel cannot be pointed at an unexpected endpoint by a task or fixture.
 * - **No retention.** The response is decoded, mapped to `GatewayResponse`,
 *   and returned; nothing is cached, logged, or written.
 * - **Fail-closed cost.** The frontier's savings math is only as honest as
 *   `costUsd`; if the endpoint reports no cost (OpenRouter `usage.cost` body
 *   field or LiteLLM `x-litellm-response-cost` header), the adapter throws
 *   rather than fabricating a zero that would flatter every candidate.
 *
 * Tests inject `fetchImpl` (the hard rule: no real model, key, or network in
 * tests).
 */

import type { Gateway, GatewayRequest, GatewayResponse } from "./gateway.js";

export class GatewayError extends Error {
  constructor(
    public readonly code:
      | "host_not_allowlisted"
      | "http_error"
      | "malformed_response"
      | "cost_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface OpenAiCompatGatewayOptions {
  /** Base URL of the in-VPC LiteLLM proxy / OpenRouter endpoint (no trailing slash). */
  baseUrl: string;
  /**
   * Hosts the adapter may call — the network half of the egress allowlist.
   * `baseUrl`'s host must be present; there is no implicit default.
   */
  allowedHosts: readonly string[];
  /** Per-request key accessor (client env). Never stored, logged, or thrown. */
  getApiKey: () => string;
  /** Injected in tests; defaults to global fetch in the client VPC runtime. */
  fetchImpl?: typeof fetch;
  /** Injected monotonic clock for latency measurement (tests). */
  nowMs?: () => number;
}

interface ChatCompletionBody {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { cost?: unknown };
}

/** Replace any occurrence of the key in a message so an error can never leak it. */
function scrub(message: string, key: string): string {
  return key.length > 0 ? message.split(key).join("[redacted]") : message;
}

function resolveCostUsd(body: ChatCompletionBody, headers: Headers): number | null {
  // OpenRouter reports cost in the response body when usage accounting is on.
  if (typeof body.usage?.cost === "number" && Number.isFinite(body.usage.cost)) {
    return body.usage.cost;
  }
  // LiteLLM proxy reports it as a response header.
  const header = headers.get("x-litellm-response-cost");
  if (header !== null) {
    const parsed = Number.parseFloat(header);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Build the production gateway. Pure construction — nothing is contacted until
 * `run` is called, and every `run` re-checks the allowlist and re-reads the key.
 */
export function createOpenAiCompatGateway(options: OpenAiCompatGatewayOptions): Gateway {
  const { baseUrl, allowedHosts, getApiKey } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? (() => performance.now());
  const url = new URL(`${baseUrl}/chat/completions`);

  return {
    async run(request: GatewayRequest): Promise<GatewayResponse> {
      if (!allowedHosts.includes(url.host)) {
        // Refused BEFORE any network call — the egress allowlist's network half.
        throw new GatewayError(
          "host_not_allowlisted",
          `gateway host "${url.host}" is not on the egress allowlist`,
        );
      }

      const key = getApiKey();
      const started = nowMs();
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: request.model,
            messages: [{ role: "user", content: request.input }],
            // OpenRouter: include usage accounting so the response carries cost.
            usage: { include: true },
          }),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new GatewayError("http_error", scrub(`gateway request failed: ${message}`, key));
      }
      const latencyMs = Math.max(0, Math.round(nowMs() - started));

      if (!response.ok) {
        // Status only — the error body could echo the prompt, which must not
        // propagate into anything that might later egress.
        throw new GatewayError("http_error", `gateway responded ${response.status} for ${request.model}/${request.taskId}`);
      }

      let body: ChatCompletionBody;
      try {
        body = (await response.json()) as ChatCompletionBody;
      } catch {
        throw new GatewayError("malformed_response", "gateway response was not JSON");
      }

      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new GatewayError("malformed_response", "gateway response carried no message content");
      }

      const costUsd = resolveCostUsd(body, response.headers);
      if (costUsd === null) {
        // Fail closed: a fabricated $0 would flatter every candidate's frontier.
        throw new GatewayError(
          "cost_unavailable",
          "gateway reported no cost (expected OpenRouter usage.cost or LiteLLM x-litellm-response-cost); refusing to fabricate one",
        );
      }

      return { output: content, costUsd, latencyMs };
    },
  };
}
