/**
 * Gateway port (methodology: TRD §2, step 2).
 *
 * The harness runs the candidate panel through an injected `Gateway`. Production
 * wires this to LiteLLM/OpenRouter inside the CLIENT'S environment with the
 * CLIENT'S keys; the harness itself never holds a key. Tests inject
 * `StubGateway`, a fixture map, so no real model, key, or network is ever
 * touched (the hard rule).
 */

export interface GatewayRequest {
  model: string;
  taskId: string;
  /** Zero-based trial index, so a stub can vary output run-to-run for Pass^k. */
  trial: number;
  input: string;
}

export interface GatewayResponse {
  output: string;
  costUsd: number;
  latencyMs: number;
  /**
   * True when this response is NOT a distinct recorded trial but a repeat of an
   * earlier one, because more trials were requested than the capture holds.
   *
   * A replay is not evidence. It carries no run-to-run information, so counting
   * it as a sample inflates every statistic derived from it: the judge's sample
   * size, and Pass^k, which reads agreement between copies of one output as
   * consistency across runs. `runAudit` excludes replays from both and reports
   * them; omit the field (or set it false) for a real trial.
   */
  replayed?: boolean;
}

export interface Gateway {
  run(request: GatewayRequest): Promise<GatewayResponse>;
}

/** A fixture entry; `outputs` may vary per trial to exercise run-to-run variance. */
export interface StubModelFixture {
  costUsd: number;
  latencyMs: number;
  /**
   * Output per (taskId, trial). A trial index past the end of the series repeats
   * the last entry and is flagged `replayed`, so no consumer can mistake the
   * repeat for a fresh observation of the model.
   */
  outputs: Record<string, string[]>;
}

/** In-memory gateway driven entirely by fixtures. Never calls out. */
export class StubGateway implements Gateway {
  constructor(private readonly fixtures: Record<string, StubModelFixture>) {}

  async run(request: GatewayRequest): Promise<GatewayResponse> {
    const model = this.fixtures[request.model];
    if (model === undefined) throw new Error(`no stub fixture for model ${request.model}`);
    const series = model.outputs[request.taskId];
    if (series === undefined || series.length === 0) {
      throw new Error(`no stub output for ${request.model}/${request.taskId}`);
    }
    const replayed = request.trial >= series.length;
    const output = series[Math.min(request.trial, series.length - 1)]!;
    return { output, costUsd: model.costUsd, latencyMs: model.latencyMs, ...(replayed ? { replayed } : {}) };
  }
}
