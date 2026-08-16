# Dossier Engine Specification

## Status
AUTHORITATIVE — LCSP-999

## Purpose
`DossierEngine` creates version-pinned compliance dossiers as views over already verified LCSP artifacts. Dossier generation does not re-scan source and does not create missing facts.

## First dossier type
`AI_RISK_CLASSIFICATION` is the initial type. The internal canonical dossier contains system identity, intended use, technical AI profile, data processing, affected subjects, decision impact, human oversight, external providers, risk indicators, risk classification/rationale, evidence appendix, applicable provisions, conflicts/unresolved evidence, gaps, remediation and provenance.

## Provenance
A dossier pins repository snapshot, Program Evidence Graph, TechnicalEvidenceReport, WizardProfile, VerifiedProfile, LegalCorpusVersion, LegalRuleCatalogVersion, ClassificationResult and Gap Matrix. Missing mandatory artifacts produce `INCOMPLETE`; they are never filled by inference.

## Extensibility
Future high-risk technical dossier, conformity assessment, AI impact assessment, incident report, transparency report, data processing assessment, third-party review and compliance audit report reuse the same evidence/artifact chain and only add dossier definitions/sections/renderers.

## Remediation
A remediation suggestion identifies problem, why it matters, source/graph locations, recommended change and re-scan verification. Suggestions stay `PROPOSED`; only new accepted evidence from a later snapshot can establish remediation.
