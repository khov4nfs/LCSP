# LCSP Version History

This document is the canonical product/architecture evolution history for LCSP. Product-version labels (`v1`, `v2`, `v3`) describe major architectural generations and must not be confused with internal schema versions such as `Program Evidence Graph v2/v3`.

## Summary

| Version | Period | Status | Architectural shift |
|---|---|---|---|
| v1 — Evidence-driven Compliance Pipeline | 2026-07-04 → 2026-08-15 | Superseded | Deterministic scanners produce technical evidence; Wizard evidence is reconciled; governed legal rules use exact/vectorless legal context for downstream classification. |
| v2 — Program Evidence Graph + EngineeringRule Assessment | 2026-08-16 → 2026-08-23 | Implemented / current baseline | Repository-wide Program Evidence Graph replaces evidence-list-centric investigation; LegalRules compile to EngineeringRules; LLMs investigate evidence while deterministic evaluators own final EngineeringRule status. |
| v3 — Deep Agents & Context-Engineered Platform | From 2026-08-23 | In development | Evolve the custom agentic runtime into structured Deep Agents with richer product/document context, Git-provider abstraction, governed orchestration, skills/memory/tool boundaries and future system-level context capabilities. |

---

## v1 — Evidence-driven Compliance Pipeline

**Period:** 2026-07-04 → 2026-08-15  
**Status:** Historical / superseded by v2 runtime

### Evidence finding

LCSP scans repository source using deterministic/static analysis tools and produces provenance-backed technical evidence. The scanner toolchain includes Semgrep rules, Syft SBOM, dependency analysis, Python AST/CST, bounded TS/JS analysis and static-flow/signal processing.

The scanner is not an LLM reading the whole repository. Its role is to create bounded, traceable technical evidence about AI usage, dependencies, invocations, data/decision flows, human review/oversight controls and coverage limitations.

```text
Repository Snapshot
        ↓
Deterministic Scanner Tools
        ↓
Technical Evidence / Findings
```

### Evidence reconciliation

Scanner evidence is combined with Wizard declarations. The runtime detects material contradictions, missing information and unsupported claims, then resolves or blocks conflicts before downstream classification.

```text
Technical Evidence + Wizard Inputs
               ↓
      Conflict Detection
               ↓
       Conflict Resolution
               ↓
        Verified Context
```

### Legal classification

The verified assessment context is evaluated against governed `LegalRule` identities. ChromaDB is used in structure-first/vectorless mode to retrieve exact legal context and citations rather than delegating legal applicability to semantic RAG.

Key authority boundary:

- scanner evidence is technical evidence, not a legal conclusion;
- vectorless retrieval supplies exact legal context/citations;
- governed legal-rule logic remains the authority for legal applicability;
- LLM output is not a compliance certification or formal legal opinion.

### Representative implementation history

- Scanner/evidence pipeline tasks existed from the original Jira implementation set created on 2026-07-04.
- The consolidated scanner/evidence implementation PR (#135) was opened on 2026-08-11 and merged on 2026-08-15.

---

## v2 — Program Evidence Graph + EngineeringRule Assessment

**Period:** 2026-08-16 → 2026-08-23  
**Status:** Implemented / current runtime baseline before Deep-Agent refactor

### Program Evidence Graph

LCSP replaces evidence-list-centric investigation with a repository-wide Program Evidence Graph built from deterministic scanner outputs and semantic IR.

The graph can represent relationships including:

- files, modules, symbols, functions and classes;
- imports and package dependencies;
- parameters, returns, variables, assignments and aliases;
- calls and static data flows;
- routes, events, queues, CQRS and persistence;
- external APIs and AI/model invocations;
- business actions and evidence-backed business semantics;
- sensitive-data semantics and human-control evidence;
- unresolved or dynamic frontiers.

```text
Repository Snapshot
        ↓
Full Scanner
        ↓
Semantic IR
        ↓
Program Evidence Graph
```

PR #249 (`refactor: LCSP-999 program evidence graph and legal engineering runtime`) was merged on 2026-08-16 and is the main architectural checkpoint for this shift.

### EngineeringRule compilation

Approved legal material is converted into a governed technical investigation contract:

```text
Approved Legal Corpus
        ↓
Legal Chunk
        ↓
Governed LegalRule
        ↓
Exact vectorless legal context
        ↓
Compiled EngineeringRule
```

An `EngineeringRule` defines technical investigation goals and bounded evidence requirements such as required evidence, supporting/negative evidence, unresolved conditions and retrieval concepts. The compiled rule is fingerprinted/cached and does not change LegalRule identity or legal authority.

### Direct EngineeringRule assessment

The canonical assessment path was refactored to:

```text
Wizard (optional context)
        +
Repository Snapshot
        ↓
Full Scan
        ↓
Semantic IR
        ↓
Program Evidence Graph
        ↓
EngineeringRule-guided LLM investigation
        ↓
Validated EvidenceClaims
        ↓
Deterministic EngineeringRuleEvaluator
        ↓
COMPLIANT / NON_COMPLIANT / UNKNOWN
        ↓
Gap Analysis / Final Report
```

PR #253 was merged on 2026-08-18 and removed the following chain from new production assessment execution:

```text
TechnicalProfile
→ AIUsageFlow
→ Conflict Detection/Reconciliation
→ VerifiedProfile
→ Legal Matching/LegalRuleMatch
→ legacy classification worker
```

Historical models/endpoints may remain only for persisted-data compatibility during migration.

### LLM authority boundary

In v2, the LLM is an **investigator**, not the compliance judge.

- LLMs query bounded graph/code tools and emit evidence claims.
- Provider SDKs do not receive unrestricted source execution authority.
- LCSP validates tool calls and executes deterministic graph/query functions itself.
- The LLM does not decide legal applicability, legal risk tier, certification, or final `COMPLIANT | NON_COMPLIANT | UNKNOWN` status.
- `EngineeringRuleEvaluator` owns the deterministic final EngineeringRule evaluation.

### EngineeringRule Planner

PR #261, merged on 2026-08-20, introduced one planning pass before per-rule investigation.

```text
Wizard Context
       +
Program Evidence Graph
       +
EngineeringRule Contracts
       ↓
EngineeringRule Planner
       ↓
Deterministic Plan Gate
       ├── SKIP
       └── SELECT
              ↓
        Investigator
              ↓
   Deterministic Evaluator
```

The Planner only selects technical investigation scope. It does not create LegalRule/EngineeringRule identities or decide legal applicability, risk tier, or compliance result.

### Business-aware planning and runtime hardening

PR #263, merged on 2026-08-23, hardened the orchestrator/investigator and enriched the Planner with evidence-backed business scope such as:

- business processes and decisions;
- affected subjects;
- data categories;
- AI capabilities;
- model lifecycle stages;
- decision-influence state;
- human-oversight state;
- material source refs;
- unresolved frontiers.

Only provenance-gated material enters this projection; unresolved/empty evidence is never treated as proof of absence.

PR #263 is the closing checkpoint for the v2 architectural generation.

---

## v3 — Deep Agents & Context-Engineered Platform

**Start:** 2026-08-23  
**Status:** In development

v3 must not be described simply as the first “agentic” version. Agentic evidence orchestration already existed before v3 (for example Jira Epic LCSP-157 and AO-1 → AO-6). The v3 shift is from the custom agentic runtime toward a structured **Deep-Agent and context-engineered platform architecture**.

### 1. Structured Deep Agents — IN DEVELOPMENT

Jira:

- `LCSP-238 — Module: Deep Agents`
- `LCSP-241 — Refactor to structured deep agents`

Target architecture separates orchestration from specialized responsibilities and preserves deterministic authority boundaries.

```text
                    Orchestrator
                         │
            ┌────────────┼────────────┐
            ↓            ↓            ↓
        Planner      Investigator   Reviewer
            │            │            │
            └────────────┼────────────┘
                         ↓
                    Tool Runtime
                         ↓
       Graph / Code / Legal / Docs / Git / MCP
```

The expected workflow shape is:

```text
plan
→ investigate
→ NEEDS_INPUT
→ resolve
→ resume
→ deterministic gate
```

### 2. Adaptive Wizard / business-product context — IN DEVELOPMENT

Jira:

- `LCSP-239 — Update wizard form with more context business product fields`
- `LCSP-237 — Research and create node upload docs for engineer context wizard form`

The fixed Wizard evolves toward context-aware collection. Agent nodes may identify missing product/business information, request the smallest additional input, persist provenance and resume from a durable checkpoint.

```text
Initial Context
      ↓
Context Analysis
      ↓
Enough? ── yes ──→ continue
  │
  no
  ↓
NEEDS_INPUT
  ↓
Targeted Question / Document Request
  ↓
Resolve
  ↓
Resume
```

### 3. Documentation context — IN DEVELOPMENT

LCSP will use product/business/architecture documentation as additional context rather than relying on Wizard answers alone.

```text
Wizard Context
    +
Uploaded Documents
    +
Architecture / Technical Docs
    +
Repository Evidence
    ↓
Bounded Product / Business Context
```

The goal is to clarify product purpose, use cases, actors, business processes, deployment context and engineering intent while keeping technical/legal evidence provenance explicit.

### 4. Git-provider abstraction — IN DEVELOPMENT / RESEARCH

Jira:

- `LCSP-240 — Research and replace git app to cli shell`

Target direction:

```text
LCSP
 ↓
Git Provider Adapter
 ├── GitHub → gh
 ├── GitLab → glab
 └── Generic Git / provider-specific adapter
```

The intent is to reduce GitHub-App-specific coupling and allow repository operations through governed provider adapters/native CLI tooling.

### 5. System / multi-repository graph — PLANNED

Extend repository graphing beyond one repository to represent monorepos and distributed repositories and relationships among services, workers, APIs, queues, databases, event boundaries and AI components.

```text
System
├── Repo A → API Service
├── Repo B → AI Worker
├── Repo C → Web App
└── Infra  → Queue / Database
```

This capability is **planned**. It must not be documented as implemented until a dedicated implementation task/PR establishes the runtime.

### 6. Deep-Agent runtime capabilities — TARGET / PARTLY EXISTING FOUNDATION

v3 standardizes capabilities that partly exist in earlier agentic/evidence infrastructure and extends them for Deep Agents:

- orchestrator/planner/investigator/reviewer responsibilities;
- typed agent outcomes and structured responses;
- durable checkpoints and resume semantics;
- `NEEDS_INPUT`, `BLOCKED`, `FAILED`, `COMPLETED` state contracts;
- deterministic policy/evidence gates;
- controlled application tools and allow-listed tool catalog;
- agent skills distinct from executable tools;
- scoped short-term, assessment and long-term memory;
- scanner/execution/workspace sandbox boundaries;
- human-in-the-loop resolution with provenance;
- context construction from Wizard, documents, graphs, EngineeringRules, memory and tool results.

### 7. Scheduled agent workflows — PARTLY IMPLEMENTED, TO BE GENERALIZED

Scheduled legal change detection already exists in Jira task `LCSP-231` and its supporting runtime. v3 should generalize this pattern into schedulable agent workflows rather than claiming that cron/scheduling begins for the first time in v3.

### 8. MCP / external context — PLANNED

Expose governed external tools/context providers through the LCSP tool runtime using MCP where appropriate.

This remains **planned** until a dedicated implementation task/PR is present. MCP must not bypass PBAC, tool allow-lists, audit, provenance, context limits or deterministic gates.

### 9. Repository knowledge / OpenWiki — PLANNED

Generate or maintain a navigable repository/system knowledge representation that agents can use as bounded context for large-codebase investigation.

This remains **planned** until implementation is tracked and merged.

### 10. Context engineering — V3 DESIGN PRINCIPLE

v3 builds agent context dynamically instead of relying on a single large static prompt.

```text
Wizard Inputs
   +
Business / Product Docs
   +
Repository / System Graph
   +
EngineeringRules
   +
Scoped Memory
   +
Tool Results
   +
Human-provided Context
   ↓
Bounded Agent Context
```

Context engineering does not change the core authority model: deterministic scanner facts, governed LegalRules, validated evidence provenance and deterministic evaluation/gates remain authoritative.

---

## Version boundary rules

1. **LCSP product versions are not internal schema versions.** `Program Evidence Graph v2/v3` may evolve independently of LCSP product `v1/v2/v3`.
2. **Agentic ≠ v3.** Agentic Evidence Orchestration was already implemented before the Deep-Agent v3 generation.
3. **LLMs investigate; deterministic code gates/evaluates.** Do not describe v2/v3 as “LLM classification” when the authoritative evaluator is deterministic.
4. **Planned capabilities must remain labelled Planned.** Multi-repository graph, MCP and OpenWiki are not considered implemented without corresponding runtime tasks/PRs.
5. **Historical workflows must not be presented as current production flow.** In particular, the v1 `TechnicalProfile → AIUsageFlow → Reconciliation → VerifiedProfile → Legal Matching → legacy classification` chain was removed from new production assessment execution by PR #253.

## Key checkpoints

| Date | Checkpoint |
|---|---|
| 2026-07-04 | Original Jira implementation stories/tasks established, including deterministic scanner foundation. |
| 2026-08-11 | Agentic Evidence Orchestration epic (LCSP-157) and AO stories created; scanner/evidence consolidation active. |
| 2026-08-15 | PR #135 scanner/evidence consolidation merged; v1 boundary closes. |
| 2026-08-16 | PR #249 Program Evidence Graph + legal engineering runtime merged; v2 starts. |
| 2026-08-18 | PR #253 direct EngineeringRule graph assessment flow merged. |
| 2026-08-20 | PR #261 EngineeringRule Planner merged. |
| 2026-08-23 | PR #263 planner/runtime/business-scope hardening merged; v2 closes. |
| 2026-08-23 | LCSP-237/238/239/240/241 created for docs context, Deep Agents, richer Wizard, Git CLI abstraction and structured Deep-Agent refactor; v3 starts. |

## References

### GitHub

- PR #135 — scanner/evidence consolidation
- PR #249 — Program Evidence Graph and legal engineering runtime
- PR #253 — direct EngineeringRule graph assessment flow
- PR #261 — EngineeringRule execution-scope Planner
- PR #263 — planner scope, investigation and transparency hardening

### Jira

- LCSP-157 — Epic: Agentic Evidence Orchestration
- LCSP-158 → LCSP-163 — AO-1 → AO-6
- LCSP-220 — EngineeringRule Planner / orchestration checkpoint
- LCSP-231 — scheduled legal change/update pipeline
- LCSP-237 — docs context for Wizard/engineering context
- LCSP-238 — Module: Deep Agents
- LCSP-239 — richer business/product Wizard context
- LCSP-240 — Git App → CLI/provider abstraction research
- LCSP-241 — structured Deep Agents refactor
