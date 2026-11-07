# LCSP-347 — Prompt, instruction, and negative-control eval hardening

**Date:** 2026-11-04. **Target:** PR #456. **Boundary:** provider-free synthetic tests, not live legal accuracy or production acceptance.

## Root cause

- The original Preparation semantic oracle scored normative actor/modality/action and development inclusion but could miss corrupted material-claim content, altered normative modifiers (object, scope, exception, timing, mixed assessability), or changes between NON_DEVELOPMENT and LEGAL_REVIEW_REQUIRED. Its parity digest likewise omitted typed modifier frames.
- The previous test oracle reused one synthetic graph for most mutations. Passing those assertions did not show resistance across distinct source structures, let alone unseen legal documents.
- Assessment tool workflow guidance existed for only 8 of 21 registered Assessment/code-graph tools. Root/Preparation instructions documented rules extensively but lacked a compact, ordered decision and falsification/repair checkpoint near the top of the prompts.

## Fix

1. Extend `evaluate_preparation_semantics` with opt-in source-annotated `normativeClaims[].frame`, `contextClaims[]`, `nonDevelopmentClaimIds` and `unresolvedClaimIds`. The scorer now emits 7 additional critical categories without accepting absent details as proof. It remains read-only and never grants legal authority.
2. Include operative and material-context frames in EN/VI canonical parity signatures. Different prose may need a reviewer-aligned representation; a MATCH remains **NOT** evidence of legal correctness.
3. Version an invented bilingual source bank at `deepagents/evals/fixtures/preparation_adversarial_cases_v1.json`: 10 cases covering split actors, mixed repository/external duties, prohibition, permission, temporal branches, third parties, unresolved ownership, physical acts, cross-references, and exceptions.
4. Apply **28 independent destructive mutations to each of the 10 cases** in `tests/test_preparation_behavior_mutation_bank.py`: omission, invention, actor/action/modality/source drift, lost or altered normative modifiers, context omission/type/authority/content/provenance, wrong/missing/reversed material edges, unrelated context leakage, wrong review stage, missing/duplicate/stale decisions. Every mutation must produce a **specific** expected critical error, not an arbitrary failure.
5. Add one falsifiable cross-locale frame-drift check per case; matching labels alone never prove semantics.
6. Expand EN/VI tool playbooks to all **21** declared Assessment and code-graph tools with WHEN/READ/NEXT/FAILURE, explicitly bound to schema and API authority. Insert a compact bounded decision transaction and negative controls in both Root locales, and a source-faithful phase transition table in Preparation common instructions.
7. Add explicit `Preparation semantic negative-control gate (280 mutations)` steps to `.github/workflows/test.yml` and `.github/workflows/check-changed.yml`. The gate must run **before** the broad Python suite and fail CI if a scenario regresses.

## Provider-free measurements

| Metric                                                     |                       Observed |
| ---------------------------------------------------------- | -----------------------------: |
| Distinct synthetic bilingual source cases                  |                             10 |
| Mutation operators per case                                |                             28 |
| Explicit negative controls                                 |                            280 |
| Mutants detected in the **expected critical category**     |                      280 / 280 |
| Clean synthetic cases falsely rejected                     |                         0 / 10 |
| Extra parity cases                                         | 10 (2 frame-drift checks each) |
| EN/VI tool playbooks with explicit workflow                |                        21 / 21 |
| Focused regression run (including old prompt/oracle tests) |                       366 PASS |
| New business-logic documentation violations                |                              0 |

**What this measures:** sensitivity and precision of the offline oracle on deliberately corrupted synthetic typed outputs, prevention of _regression in the eval gate_, preservation of tool contracts and stronger documented model instructions.

**What this does not measure:** whether a real agent correctly extracts claims from raw law, whether the gold labels are legally correct, actual model false-positive rate, prompt lift on a holdout, real EN/VI semantic agreement, or safe production activation. The synthetic annotations and model-like baseline come from the same authored case specifications; they are **not** independent human-reviewed gold. 280 mutants are _not_ 280 independent legal documents or successful model runs.

## Remaining independent semantic acceptance

To prove prompt quality improves, a separate evaluation must use pinned Legal Source Version evidence and independently reviewed gold labels and previously unseen model outputs. Compare baseline and candidate prompts **on the same fixed model, source pins, temperature and run budget**; record prompt/skill/tool hashes, model ID, corpus hash, gold-review revision, actual API usage and cost. Include EN/VI runs and genuine negatives (unused code/README-only claims, operator unknown, mixed actors, source exceptions, temporal transitions, truncated search, source pins changed), plus false positives, false negatives and HITL decisions. Hold out an unseen corpus partition. Production acceptance requires zero critical leakage/fabrication, no high-risk regression against baseline, and sign-off on actual remaining ambiguity. Existing Scope Review approval and API validation remain independent hard gates.

**Release status:** Passing the synthetic oracle gate is necessary for this workstream but insufficient for production legal compliance; do not auto-approve or deploy based on this report.

## Reviewed-eval evidence admission (follow-up)

The default CLI remains a **diagnostic** scorer. A clean synthetic comparison can return exit 0 **only as a diagnostic**; `productionAcceptance` stays `NOT_PROVEN`. It is not a release-gate PASS.

For a separately authorized review, use the guarded mode with **two independently supplied inputs**:

```bash
cd deepagents
python -m rule_set_preparation.eval_cli \
  --gold /path/to/reviewed-gold.json \
  --candidate /path/to/frozen-model-output.json \
  --approved-gold-sha256 '<sha256-from-independent-review-approval>' \
  --run-manifest /path/to/reconciled-model-manifest.json
```

The guard also verifies that the parsed gold object is identical to the pinned file bytes, so a forged in-memory review status cannot borrow the unchanged file hash.

The runner must supply a trusted reviewed gold digest from release governance, not compute it from the candidate file as a substitute for approval. A complete reviewed gold contains `goldApprovalStatus=HUMAN_APPROVED`, a nonempty `goldReviewerRevision`, source-bound normative frames, context claims and material relations, and all stage-disposition sets. The candidate must carry `runId`, `responseLanguage` and `promptManifestSha256` matching a valid immutable model-facing manifest. The manifest must identify the right Preparation component, pinned source, reviewed gold revision, configured model, resolved prompt/tool hashes, actual attempts/tokens and reconciled provider cost/currency.

A missing or mismatched input yields exit code **4** and `reviewedEvidenceGate.status=BLOCKED`; a semantic mismatch yields **2**. A clean strict-mode report yields `INPUT_CONTRACT_PASSED_NOT_LEGAL_APPROVAL`, **not** a production approval. The code checks digest/identity/usage consistency; **it does not cryptographically authenticate who approved the hash, who supplied billing values, or whether the LLM actually executed**. Those must be verified by external trusted review/journal systems.

The targeted CI job now also runs `test_reviewed_eval_gate.py`, including rejection of synthetic gold, stale corpus pins, missing frame annotations, changed manifests, incomplete/invalid usage and unreal billing values. This is independent of live-model acceptance.
