---
task_id: MW-cls-py-001
module: python-workers/classification
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 6.2
depends_on:
  - python-workers/legal/01-chromadb-legal-retrieval-worker.md
  - python-workers/llm/01-llm-gateway-client.md
---

# Classification Worker

## Outcome

Consume `legal-rule-match-ready` events and generate classification output using `VerifiedProfile` + `LegalRuleMatch` through a **bounded LangGraph runtime**. Deterministic hard rules, citation gates, and legality constraints must execute before and after any model-assisted reasoning node. A model-assisted node may help synthesize a classification proposal from approved inputs, but it cannot override hard-rule precedence, citation guardrails, or supported output taxonomy. Apply citation guardrail (degrade or block if citation basis missing). Never overclaim certification or compliance.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/classification/classification/__init__.py` | Create | Package init |
| `deepagents/tools/classification/classification/classification_consumer.py` | Create | `ConsumerBase` for `legal-rule-match-ready` |
| `deepagents/tools/classification/classification/classification_graph.py` | Create | LangGraph workflow for classification orchestration |
| `deepagents/tools/classification/classification/risk_tier_calculator.py` | Create | Deterministic precedence and support calculators used before/after model-assisted nodes |
| `deepagents/tools/classification/classification/rationale_narrator.py` | Create | Optional gateway-backed rationale drafting for an already-validated classification result |
| `deepagents/tools/classification/classification/citation_guardrail.py` | Create | Guardrail: passed \| degraded \| blocked |
| `deepagents/tools/classification/classification/overclaim_detector.py` | Create | Output guardrail against overclaim wording |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `classification.legal-rule-match-ready` |
| Routing key | `legal-rule-match-ready` |
| PBAC preflight | No (system event) |

## Classification Data Schema

```python
@dataclass
class ClassificationData:
    classification_version: str
    usage_claims: list[dict]            # From VerifiedProfile (claim_category, confidence)
    applicable_rules: list[dict]        # From LegalRuleMatch (rule_id, article_ref, match_type, confidence, coverage_status)
    risk_level: str                     # Final value must satisfy deterministic precedence + guardrails; model-assisted proposal cannot bypass them
    applicability_assessment: str       # Final value must satisfy deterministic precedence + guardrails
    citation_refs: list[str]            # Citation chunk IDs backing the decision
    citation_coverage: str              # NO_CITATION | PARTIAL_CITATION | COMPLETE_CITATION
    rationale: str | None               # Optional LLM-drafted narrative text describing the decision above — never the source of the decision
    guardrail_status: str               # 'passed' | 'degraded' | 'blocked'
    guardrail_reason: str | None
```

## Risk Tier and Guardrail Evaluation

1. Hard-rule precedence, legal support thresholds, citation coverage checks, and supported taxonomy checks run deterministically per `docs/specs/legal-classification-spec.md` before any classification proposal is accepted.
2. Classification must not use provider/model/framework presence alone, unverified Manager claims, unresolved conflict, or missing citation as sufficient legal basis for `risk_level`.
3. A model-assisted node may propose `risk_level`, `applicability_assessment`, structured reasons, and rationale text from approved `VerifiedProfile` + `LegalRuleMatch` inputs, but the proposal is accepted only if it passes deterministic precedence, citation allowlist, schema validation, and unsupported-basis rejection.
4. If rationale drafting is used after acceptance, it is still validated against the accepted classification result and cannot alter that result.

## Citation Guardrail Rules

| State | Condition |
|---|---|
| `passed` | All decision citations in `LegalRuleMatch.citationAllowlist`, none `REPEALED` |
| `degraded` | Some citations missing — decision uses only verified citations, rest degraded |
| `blocked` | No valid citations — classification cannot proceed |

## Overclaim Wording Detector

Applies only to the optional `rationale` narrative text (never to the deterministic `risk_level` field itself, which uses its own fixed enum). Block rationale output that contains: `certified`, `validated`, `approved`, `compliant`, `non-compliant`, `production ready`, `legally approved`.

## Business Rules

1. Fetch `LegalRuleMatch` and `VerifiedProfile` from NestJS API.
2. Require `LegalRuleMatch.guardrailStatus = passed` before computing a classification-eligible decision.
3. Run deterministic pre-checks to establish eligible rule set, blocked/degraded conditions, and the allowed output taxonomy before any model-assisted reasoning node is invoked.
4. If model-assisted reasoning is required, build a sanitized structured request from evidence metadata and invoke `LLMGatewayClient.complete()` or equivalent structured gateway method with workflow/node context, budget cap, and approved prompt/template version.
5. Validate the model-assisted output against schema, hard-rule precedence, citation allowlist, provider-only rejection, and unsupported-basis checks; reject or degrade on conflict.
6. If a human-readable rationale is required downstream, draft or normalize it only after an accepted classification result exists.
7. Run `OverclaimDetector.check(rationale)` on the narrative text — reject if overclaim detected, set `guardrail_status = blocked` or omit rationale according to policy.
8. Submit to `POST /internal/classification/result-callback`.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Valid match + valid citations | `guardrail_status = passed`, final classification passes deterministic precedence and guardrails |
| T02 | Missing some citations | `guardrail_status = degraded` |
| T03 | No valid citations | `guardrail_status = blocked` |
| T04 | Rationale contains `certified` | Rationale rejected, `guardrail_status = blocked` for the narrative; `risk_level` unaffected |
| T05 | `LegalRuleMatch.guardrailStatus = blocked` | Classification not started |
| T06 | Raw source in LLM prompt | `PromptSafetyViolation` raised |
| T07 | Budget exceeded | `BudgetExceeded`; classification degrades or blocks per node policy |
| T08 | Model-assisted output conflicts with hard-rule precedence | Output rejected; final classification remains deterministic-safe or blocked/degraded |
| T09 | Classification runs without any LLM call in the pipeline | Confirmed — deterministic-only fallback remains supported |

## Definition of Done

- Final `risk_level`/`applicability_assessment` always satisfies deterministic precedence, citation guardrails, and supported taxonomy checks.
- Model-assisted nodes, if used, operate only through `LLM Gateway` with sanitized inputs and cannot bypass the accepted decision constraints.
- LLM prompt/request payload (when used) contains no raw source code.
- Overclaim wording detected and blocked in rationale text.
- Citation guardrail applied: `passed` | `degraded` | `blocked`, `REPEALED` citations never accepted.
- Monthly LLM budget cap applied when LLM is used.
