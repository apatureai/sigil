# PRD — Independent AI Quality & Efficiency Assurance

> Working codename only; practice/brand name unratified. Decision of record: apatureai/core #134. Research dossier: apatureai/core #135 + RESEARCH.md.

## 1. Problem
Enterprises run LLMs/agents in high-consequence workflows but **cannot answer "did a model quietly regress below OUR quality bar?"** — because the tools they own measure a *generic* quality proxy with no error bars, and every party that could measure it (model labs' FDE arms, router vendors, eval platforms shipping their own gateways, Big-4 with cloud alliances) **has something to sell** and is therefore conflicted. In regulated industries this is not a preference but a **regulatory gap**: independent validation of model outputs is now required.

## 2. Who buys, and why now
- **Buyer:** Model Risk Management / independent model validation in **financial services** (a staffed, budgeted function since SR 11-7; budget *grows* under scrutiny). Secondary stakeholder: a FinOps/platform owner for the cost angle.
- **Forcing function (fresh, 2026):** **SR 26-2** (Fed/OCC/FDIC, Apr 2026, superseding SR 11-7) reaffirms independent validation, ongoing monitoring, and **third-party model governance**. Examiners now **accept output-based validation against a labeled benchmark set, run quarterly** for vendor LLMs (weight validation being impossible). OSFI E-23 (May 2027) and RBI draft extend lifecycle third-party validation internationally.
- **Market:** AI Agent Audit & Assurance Services $0.6B (2026) → $23B by 2036 (44% CAGR), **independent third-party ~37% share**; AI MRM $8.33B (2026); FinOps-for-AI at 98% org adoption.

## 3. What we sell
An **independent, neutral assurance audit** that:
1. measures the client's OWN calibrated quality bar across model providers, with the **judge's own reliability disclosed** (ECE/Brier);
2. quantifies **run-to-run reliability** (Pass^k);
3. computes the **efficiency frontier** and the equal-quality saving (switch X→Y, save Z% at held quality);
4. maps **agent governance** (read-only least-privilege gaps) as a control-evidence attach;
5. hands back a **finance/security/examiner-signable artifact** and a **neutral router policy** the client keeps.

We sell **no model, no router, no platform** — neutrality is the moat (and, in FS, a regulatory requirement that disqualifies conflicted incumbents).

## 4. Offer & packaging
Prove-it-first: free-to-$10k 1-week pilot on ONE task family → success fee ~25% of verified year-one savings (cap ~$100–150k) → **periodic (quarterly) assurance retainer** — aligned to the examiner-accepted quarterly cadence. Run **in the client's VPC, their keys, results-only egress, zero-retention**; SOC 2 Type II on a hard date.

## 5. Boundary (what we never do)
- Never sell or operate a model/router/platform (product (a) in #134 is forbidden; only the neutral *measurement* product (b) is on the roadmap).
- Never take repo-write/checkout credentials; read-only on the client estate.
- Never call a real model/key/sandbox/network in our own tests (fixtures + injected ports).
- Never invent a fact: the report restates only what was measured; abstain honestly.

## 6. Success metrics
- **Audit:** verified equal-quality savings %; judge ECE ≤ target on the client rubric; Pass^k exposure surfaced; artifact accepted by the client's validation function.
- **Practice (graduation to product, the #134 trigger):** ≥5 paid engagements incl. ≥2 retainers (T1); **cross-client ECE transfer ≥30% better than cold-start (T2 — the data-moat proof)**; ≥2 clients request continuous re-runs (T3).

## 7. Sequenced roadmap (#134)
- **Now — boutique:** deliver audits with the harness; capture the cross-client calibration corpus; keep neutrality intact.
- **On trigger — productize the neutral *measurement* layer:** continuous, independent, calibrated assurance SaaS (sell only the verdict + error bars), valued like assurance-SaaS on EBITDA, never a router.
- **Falsifier:** if cross-client calibration does not transfer (held-out ECE improvement < ~10% by engagement #3), re-plan as a pure boutique before building v2.

## 8. Non-goals (this phase)
Multi-vertical expansion (healthcare/legal are second-wave); a routing/optimization product; a generic eval dashboard; anything that requires the client to instrument onto our platform.
