# LCSP Deep-Agent Orchestration

This document defines the LCSP v3 Managed Deep Agents boundary.

The root is a **supervisor/orchestrator**, not another investigation worker. It
owns bounded runtime context, thread/checkpoint execution memory, and the todo
plan that drives specialized subagents through one canonical assessment pipeline.

## Architecture

```text
                         Root Orchestrator
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
       runtime context    checkpoint memory    write_todos
             │                  │                  │
             └──────────────────┴──────────────────┘
                                │
                                ▼
                         assessment pipeline
                                │
                                ▼
                        context_wizard
                                │
          pinned EngineeringRules + Wizard/assessment context
                                │
                                ▼
                             planner
                                │
                                ▼
                          investigator
                                │
                    material fact unresolved?
                       /                 \
                     yes                  no
                      │                    │
                      ▼                    ▼
                 NEEDS_INPUT       deterministic gate
                      │                    │
                      ▼                    ▼
                   resolver               gap
                      │                    │
                      ▼                    ▼
             resume investigator          report
```

The important boundary is that **EngineeringRules are prepared/pinned inputs to
the pipeline**. Planner and Investigator do not discover legal rules themselves.
Context Wizard hydrates only the already-selected rule identifiers from the
approved corpus before technical planning begins.

## Root supervisor concerns

### Runtime context

`orchestration.context.LCSPRunContext` carries immutable identifiers only:

- assessment ID;
- organization/user/workflow IDs;
- checkpoint ID;
- pinned artifact versions;
- active EngineeringRule IDs.

Runtime context is propagated to subagents by `context_schema` and the bounded
runtime-context middleware. It is not evidence and cannot be rewritten into a new
authoritative value by a model.

### Memory

Managed Deep Agents/LangGraph thread checkpointing is the supervisor's execution
memory for the current run and resume point.

LCSP authoritative data remains in the API/database:

- Wizard answers;
- assessment state;
- repository/Program Evidence Graph evidence;
- approved legal corpus and EngineeringRules;
- deterministic evaluation outcomes;
- report/audit artifacts.

The project intentionally does **not** define root `memory.py`. Managed Deep
Agents deployment-shared long-term memory is therefore not used for tenant or
assessment data. `orchestration/memory.py` documents this authority boundary.

### Todos

Deep Agents v0.7+ makes todo planning opt-in. The root installs one
`TodoListMiddleware`, exposing `write_todos` to the supervisor.

Todos mirror pipeline progress. Subagents do not own independent pipeline todo
lists; each child receives one bounded stage, returns one compact handoff, and the
root updates the supervisor todo state.

## Canonical flow

```text
context_wizard
→ plan
→ investigate
→ [NEEDS_INPUT → resolve → resume → investigate]*
→ deterministic gate
→ gap
→ report
```

Allowed transitions are declared in `orchestration/pipeline.py`; `flow.py` is only
a temporary compatibility re-export.

`NEEDS_INPUT` and `resume` are orchestration states. The deterministic gate is not
a subagent and cannot be called as a model tool.

## Specialized subagents

Each subagent has an independently reviewable definition:

```text
subagents/
├── context_wizard/
│   └── definition.py
├── planner/
│   └── definition.py
├── investigator/
│   └── definition.py
└── resolver/
    └── definition.py
```

Every definition declares its own:

- name and delegation description;
- model;
- system prompt;
- minimal authored tool set;
- runtime-context middleware;
- output contract.

### Context Wizard

First model stage for every new assessment cycle.

Tools:

- `get_assessment_context`
- `get_legal_corpus_readiness`
- `retrieve_legal_basis`

Responsibilities:

- hydrate pinned Wizard/assessment context;
- hydrate approved legal basis only for the EngineeringRule IDs already supplied
  by LCSP authority;
- preserve conflicts and missing inputs;
- return one compact `PipelineContext` to Planner.

It cannot search the Program Evidence Graph, select replacement EngineeringRules,
or decide legal/compliance outcomes.

### Planner

Runs only after Context Wizard.

Tools:

- `search_program_graph`
- `get_scan_coverage`

Responsibilities:

- consume the fixed PipelineContext and EngineeringRules;
- create the smallest technical investigation scope;
- identify graph seeds and coverage limitations;
- return `INVESTIGATE` or a precise `NEEDS_INPUT`.

Planner cannot retrieve legal basis, reload Wizard context, change the active rule
set, or decide compliance.

### Investigator

Runs after Planner, or after Resolver when resuming the same plan.

Tools:

- `search_program_graph`
- `trace_static_flow`
- `inspect_data_path`
- `inspect_decision_path`
- `inspect_human_review_path`
- `get_symbol_context`
- `find_provider_invocations`

Responsibilities:

- investigate only the delegated technical scope;
- preserve Program Evidence Graph provenance;
- produce criterion-scoped evidence claims;
- surface truncation/frontier/coverage limitations;
- return one exact `NEEDS_INPUT` when required.

Investigator cannot fetch Wizard/legal context, change EngineeringRules, or emit
`COMPLIANT`, `NON_COMPLIANT`, or `UNKNOWN`.

### Resolver

Runs only after `NEEDS_INPUT`.

Tools:

- `get_assessment_context`
- `compare_wizard_claim`

Responsibilities:

- resolve the exact missing Wizard/business fact;
- preserve repository/Wizard conflicts;
- return only the context delta needed to resume the same Investigator plan.

Resolver cannot start a new repository investigation or change the active rule set.

## Model policy

Defaults live in `model_policy.py` and can be overridden by deployment env vars.

| Role | Default model | Workload |
| --- | --- | --- |
| Root orchestrator | `openai:gpt-5.6-terra` | coordination, delegation, todo/state management |
| Context Wizard | `openai:gpt-5.6-luna` | bounded context/legal hydration |
| Planner | `openai:gpt-5.6-sol` | highest-reasoning scope construction |
| Investigator | `openai:gpt-5.6-terra` | repeated tool-heavy technical investigation |
| Resolver | `openai:gpt-5.6-luna` | narrow missing-context reconciliation |

All role models receive the same LCSP harness profile.

## Agent-facing tool hierarchy

Authored model-callable tools remain physically under `tools/`:

```text
tools/
├── common/
├── planner/
├── investigator/
├── resolver/
└── orchestration/
```

Physical tool ownership and subagent exposure are intentionally separate. A tool
being in `tools/common` does not mean every subagent receives it; the canonical
role allowlists live in `orchestration/pipeline.py`.

The only authored root mutation is:

- `request_targeted_reanalysis` — protected by human interrupt.

## Deep Agents harness boundary

LCSP keeps the built-in `task` delegation primitive and root `write_todos`, while
restricting the rest of the harness:

- default `general-purpose` subagent disabled;
- `read_file` allowed only for Managed Skills under `/skills/**`;
- `ls`, `write_file`, `edit_file`, `delete`, `glob`, `grep`, and `execute` hidden;
- no shell sandbox in this assessment graph;
- repository evidence must enter through governed LCSP tools.

## Deterministic authority

The model pipeline ends after validated investigation claims.

```text
Context Wizard → Planner → Investigator/Resolver
                         │
                         ▼
                 validated EvidenceClaim
                         │
                         ▼
              deterministic EngineeringRule gate
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
        COMPLIANT  NON_COMPLIANT   UNKNOWN
```

LLM agents plan, investigate, and resolve missing context. Deterministic LCSP code
owns claim validation, EngineeringRule evaluation, gap derivation boundaries, and
the final authority trail.
