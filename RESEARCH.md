# RESEARCH — Assurance practice

> Full sourced dossier: apatureai/core #135. Adversarial validation: #126/#134. This condenses the load-bearing findings.

## Demand is regulator-defined and recurring (the strongest signal)
- **SR 26-2 (Fed/OCC/FDIC, Apr 2026)** supersedes SR 11-7: reaffirms independent validation, ongoing monitoring, and **third-party model governance**. Independence must be **structurally separated from the model developer**; examiners check for it; it extends to vendor models.
- **The accepted method IS our product:** for a Tier 1 vendor LLM the bank cannot validate weights, so examiners **accept output-based validation against a labeled benchmark set, run quarterly**. The harness measures outputs against a labeled corpus/rubric — and "quarterly" = a retainer cadence, not a one-shot.
- International: OSFI E-23 (May 2027) extends MRM to all models incl. third-party AI; RBI draft mandates lifecycle third-party validation.

## Market
- **AI Agent Audit & Assurance Services:** $0.6B (2026) → **$23.0B by 2036, 44% CAGR**; **independent third-party audit ~37% share** in 2026 (external attestation supports risk review).
- AI Model Risk Management: $8.33B (2026, +16% YoY). AI Model Evaluation Platforms: $2.36B (2026, 27% CAGR). FinOps-for-AI: 98% org adoption, #1-priority skill. Enterprise LLM spend >$8.4B.

## Competition (funded but structurally barred from independence)
- Eval/observability incumbents are one feature from the frontier view but conflicted: **Braintrust $80M Series B @ ~$800M; Arize $70M Series C @ $1B+** — both ship gateways/routers, so cannot certify "switch off our platform."
- Independent-assurance entrants validate the category (PwC AI assurance — controls attestation, not calibrated quality; Resaro, AVERI ~$7.5M, Credo) → acquirer/partner, not just competitor.
- Model-lab FDE arms (OpenAI ~$4B, Anthropic ~$1.5B JV) — conflicted by construction.

## Moat & the one open question
- Moat = **structural neutrality**, which in FS is *legally load-bearing* (SR 26-2 separation), plus a **cross-client calibrated benchmark** that no conflicted vendor can assemble (scarce, labeled, practitioner-graded data).
- **Open question / falsifier:** does calibration learned on client A transfer to client B (do practitioner rubrics rhyme within FS)? If yes → a compounding data moat and a productizable destination; if no → a profitable boutique with no product endpoint. Measured directly via the held-out ECE-transfer metric from engagement #2 (#134 T2). This single number decides venture-scale vs boutique.

## Verdict
Good. Demand is regulator-defined, recurring, and addresses a named fast-growing market where independence is the dominant share; neutrality is a defensible, regulation-backed moat. Boutique viability is high-confidence; the productized upside is conditional on the calibration-transfer falsifier. Enter financial services, one vertical, boutique-first.
