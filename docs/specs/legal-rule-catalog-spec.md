# Legal Rule Catalog Specification

## Status
AUTHORITATIVE — GOVERNED LEGAL RULE + ENGINEERING RULE DERIVATION (LCSP-999)

## Purpose
Defines governed `LegalRule` authority and its downstream relationship to machine-generated cached `EngineeringRule` technical investigation contracts.

## Separation of authority

```text
Approved LegalCorpusVersion
  -> exact citation targets
Approved LegalRuleCatalogVersion / LegalRule
  -> governed applicability/risk implication
EngineeringRule
  -> machine-generated technical investigation plan only
```

`LegalRule` remains legally governed. Production legal matching cannot use unapproved rule content. LLM compilation does not replace legal review and does not create legal truth.

## LegalRule content
A rule keeps stable `legalRuleId`, family/catalog version/status/author, `requiredFacts`, optional facts, blocking facts, unknown-fact policy, citation locator refs and risk-tier implication. Required facts must be supported by eligible evidence for deterministic matching; unknown/unbacked facts remain unresolved.

## Approval/versioning
Lifecycle is `DRAFT -> APPROVED -> SUPERSEDED`. Approved catalog versions are immutable. Every cited locator must resolve to active content in an approved legal corpus at approval time. Rule/citation/risk-implication changes require review. Legal matches pin both corpus and rule-catalog versions.

## EngineeringRule derivation
For each approved LegalRule, Python retrieves exact primary legal chunks plus structural parent/reference context from the existing vectorless index. LLM compiles one or more EngineeringRule drafts; deterministic validation enforces canonical ProgramGraph vocabulary/schema/provenance; validated rules are cached by immutable fingerprint.

EngineeringRule cache reuse is cross-assessment: unchanged law/rule/compiler does not consume compilation tokens for each repository. Referenced legal-chunk changes, schema/compiler/prompt changes or a repealed basis invalidate affected fingerprints only.

## Non-claims
EngineeringRule keywords/patterns are discovery hints, not proof. EngineeringRule cannot declare a system compliant/non-compliant or choose risk tier. EvidenceClaim validation, VerifiedProfile reconciliation and deterministic legal matching remain downstream.
