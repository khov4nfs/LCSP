# XTRAREG GDPR diagnostic evaluation

The pinned synthetic fixture contains 25 source nodes and 30 annotations (14 DEV and 16 HOLDOUT). Its approval status is `SYNTHETIC_NOT_REVIEWED`. Reviewer IDs and adjudication fields are fixture values. The fixture exercises scorer behavior offline.

The scorer reports obligation coverage, citation checks, duplicates, and structural Claim → LegalRequirement → AssessmentRule checks. It uses token similarity for candidate alignment and exact comparisons for diagnostic scoring. Differences in action, applicability, exceptions, or citations require review. A diagnostic score does not establish legal equivalence.

`matchedAssessableToRulesRate` divides complete structural chains by matched assessable gold obligations. `endToEndAssessableRuleCoverage` uses all assessable gold obligations, including extraction misses. `citationIntegrityRate` measures valid citations among scoped predictions. `semanticGroundingRate` is `null` pending independent review. `groundingReviewRequiredCount` counts predictions with valid citations that still need that review.

For V1 readers, `requirementsToRulesRate` and `expectedAssessableRules` retain the matched basis. `groundingRate` and `groundingRateDelta` retain their citation-integrity basis. The explicit metrics return `null` when their denominator is empty.

Run the diagnostic from `deepagents/` with `python -m rule_set_preparation.eval_cli --xtrareg-gold GOLD.json --xtrareg-source SOURCE.json --xtrareg-candidate PREPARATION.json --xtrareg-direct-draft DIRECT_DRAFT.json`. The report records SHA-256 digests of the bytes scored. Exit code 2 and `reviewedEvidenceGate.status=BLOCKED` indicate that release acceptance is unavailable.

Semantic quality and gain remain unevaluated. Acceptance requires a pinned verbatim legal source, independently reviewed gold, and frozen outputs and paired execution manifests from both workflows on the same holdout.
