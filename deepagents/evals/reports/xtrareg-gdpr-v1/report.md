# XTRAREG Semantic Evaluation & Regression Report (`gdpr-pinned-v1.0.0`)

- **Reference:** *LLM-assisted Extraction of Regulatory Requirements: A Case Study on the GDPR (XTRAREG)*, IEEE RE 2025
- **Scope:** `semanticClaims → LegalRequirements → AssessmentRules` across `FULL_PREPARATION` (discovery + authoring) and `DIRECT_DRAFT`
- **Pinned Legal Source:** `deepagents/evals/fixtures/xtrareg_gdpr_source_v1.json` (`gdpr-pinned-v1.0.0`, 24 source nodes)
- **Gold Annotation:** `deepagents/evals/fixtures/xtrareg_gdpr_gold_v1.json` (`30` atomic obligations/conditions/exceptions: `14 DEV`, `16 HOLDOUT`, dual-reviewer adjudication + disagreement log)
- **Scorer & CLI:** `deepagents/rule_set_preparation/xtrareg_eval.py` and `python -m rule_set_preparation.eval_cli --xtrareg-gold ... --xtrareg-source ... --xtrareg-candidate ... [--xtrareg-direct-draft ...]`

## Acceptance Criteria Verification
- **AC1 (Gold Provenance & Size):** `>= 30` atomic obligations/conditions/exceptions, `DEV` and `HOLDOUT` splits, pinned `sourceNodeIds` + verbatim `sourceQuote`, `actor`, `modality`, `applicability`, `exceptions`, and dual-reviewer provenance (`reviewerId`, `secondReviewerId`, `annotationVersion`, `adjudicationStatus`, `disagreementLog`).
- **AC2 (Critical Regression Gate):** Enforces zero `UNGROUNDED_OBLIGATION`, `MISSING_EXCEPTION`, `MODALITY_INVERSION`, and `MISSING_OBLIGATION` errors, listing every failing case in `failedCases`.
- **AC3 (Holdout Metrics & Honest Gain Assessment):** Reports `full` / `partial` / `incorrect` / `missed`, `strictPrecision`, `lenientPrecision`, `strictRecall`, `lenientRecall`, `sourceUnitCoverage`, `obligationCoverage`, `groundingRate`, `duplicateCount` / `duplicationRate`, `actorAccuracy`, `applicabilityAccuracy`, `exceptionPreservationRate`, and `chainIntegrity` (`claimsToRequirementsRate`, `requirementsToRulesRate`, `nonAssessableAccuracy`) with explicit denominators. `semanticGainClaimed` is `True` only when holdout metrics improve with zero critical errors.
