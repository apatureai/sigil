/**
 * Router-policy exporter (methodology #130, step 8) — the "we configure the best
 * router" deliverable, kept vendor-NEUTRAL.
 *
 * Translates the measured efficiency frontier into a portable routing policy the
 * client keeps and loads into whatever router they run (LiteLLM / OpenRouter /
 * NotDiamond). We export the policy; we are not the router and take no stake in
 * which model wins — the policy simply encodes "per task family, the cheapest
 * model that held the measured quality bar, with the frontier as fallbacks."
 * This is exactly the neutral measurement layer, not a fix we profit from.
 */

import type { AuditReport } from "./harness.js";

export interface RoutePolicyEntry {
  family: string;
  /** Primary: the recommended model (cheapest at held quality), or the current best. */
  primary: string;
  /** Ordered fallbacks: the rest of the frontier, by ascending cost. */
  fallbacks: string[];
}

export interface RouterPolicy {
  policyVersion: "neutral-route/1";
  /** The quality floor (calibrated) every routed model must clear. */
  qualityFloor: number;
  routes: RoutePolicyEntry[];
}

/**
 * Build a neutral routing policy from the audit. `qualityFloor` is the minimum
 * calibrated quality a routed model must meet; only frontier models at or above
 * it are eligible, ordered cheapest-first.
 */
export function exportRouterPolicy(report: AuditReport, qualityFloor: number): RouterPolicy {
  const routes: RoutePolicyEntry[] = report.families.map((f) => {
    const eligible = f.frontier
      .filter((c) => c.quality >= qualityFloor)
      .sort((a, b) => a.costPerRunUsd - b.costPerRunUsd || a.id.localeCompare(b.id));
    // If nothing clears the floor, fall back to the highest-quality candidate so
    // the policy never silently drops a family.
    const ordered = eligible.length > 0 ? eligible : [...f.candidates].sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id)).slice(0, 1);
    const [primary, ...fallbacks] = ordered.map((c) => c.id);
    return { family: f.family, primary: primary ?? "", fallbacks };
  });
  return { policyVersion: "neutral-route/1", qualityFloor, routes };
}
