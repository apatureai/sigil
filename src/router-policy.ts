/**
 * Router-policy exporter (methodology: TRD §2, step 8): a portable routing
 * policy export, kept vendor-NEUTRAL.
 *
 * Translates the measured efficiency frontier into a portable routing policy the
 * client keeps and loads into whatever router they run (LiteLLM / OpenRouter /
 * NotDiamond). We export the policy; we are not the router and take no stake in
 * which model wins. The policy simply encodes "per task family, the cheapest
 * model that held the measured quality bar, with the frontier as fallbacks."
 * This module never routes traffic itself.
 */

import type { AuditReport } from "./harness.js";
import type { SwitchQualityEvidence } from "./stats.js";

export interface RoutePolicyEntry {
  family: string;
  /** Primary: the recommended model (cheapest at held quality), or the current best. */
  primary: string;
  /** Ordered fallbacks: the rest of the frontier, by ascending cost. */
  fallbacks: string[];
  /**
   * Present when something about this route needs saying: the primary does not
   * clear the quality floor (kept rather than dropped), or paired evidence
   * reordered it quality-first. Absent means the primary met the floor on the
   * default cost-first ordering.
   */
  note?: string;
}

export interface RouterPolicy {
  policyVersion: "neutral-route/1";
  /** The quality floor (calibrated) every routed model must clear. */
  qualityFloor: number;
  routes: RoutePolicyEntry[];
}

export interface RouterPolicyOptions {
  /**
   * Paired switch-quality evidence per family (stats.ts). When a family's
   * evidence says the cheap switch is NOT defensible, that family's route is
   * ordered quality-first instead of cost-first: the exported policy must
   * never encode a cost-first ordering the audit's own statistics refused to
   * stand behind. Families without evidence keep the default cost-first order
   * with no annotation.
   */
  switchEvidence?: Record<string, SwitchQualityEvidence>;
}

/**
 * Build a neutral routing policy from the audit. `qualityFloor` is the minimum
 * calibrated quality a routed model must meet; only frontier models at or above
 * it are eligible, ordered cheapest-first, unless the family's own switch
 * evidence says cheaper-at-equal-quality is not defensible, in which case the
 * family is ordered quality-first and annotated.
 */
export function exportRouterPolicy(
  report: AuditReport,
  qualityFloor: number,
  options: RouterPolicyOptions = {},
): RouterPolicy {
  const routes: RoutePolicyEntry[] = report.families.map((f) => {
    const evidence = options.switchEvidence?.[f.family];
    const qualityFirst = evidence !== undefined && !evidence.defensible;

    const eligible = f.frontier
      .filter((c) => c.quality >= qualityFloor)
      .sort((a, b) =>
        qualityFirst
          ? b.quality - a.quality || a.costPerRunUsd - b.costPerRunUsd || a.id.localeCompare(b.id)
          : a.costPerRunUsd - b.costPerRunUsd || a.id.localeCompare(b.id),
      );
    // If nothing clears the floor, fall back to the highest-quality candidate so
    // the policy never silently drops a family. That fallback MUST be annotated:
    // an entry reading `{qualityFloor: 0.95, primary: "frontier"}` otherwise
    // asserts that frontier met 0.95, which is the opposite of what happened.
    const belowFloor = eligible.length === 0;
    const ordered = belowFloor
      ? [...f.candidates].sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id)).slice(0, 1)
      : eligible;
    const [primary, ...fallbacks] = ordered.map((c) => c.id);
    const entry: RoutePolicyEntry = { family: f.family, primary: primary ?? "", fallbacks };

    const notes: string[] = [];
    if (belowFloor) {
      const best = ordered[0];
      notes.push(
        `below quality floor: no candidate reached the floor of ${qualityFloor}; primary is the ` +
          `highest-quality candidate measured` +
          `${best === undefined ? "" : ` (${best.id} at ${best.quality})`} and does NOT clear it. ` +
          "The family is kept rather than dropped; the route is not evidence that the floor was met.",
      );
    }
    if (qualityFirst) {
      notes.push("quality-first: paired evidence found the cost-first switch not defensible (see report switchEvidence)");
    }
    return notes.length > 0 ? { ...entry, note: notes.join(" | ") } : entry;
  });
  return { policyVersion: "neutral-route/1", qualityFloor, routes };
}
