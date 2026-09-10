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
             targeted Interview           gap
                      │                    │
                      ▼                    ▼
             resume investigator          report
```

The important boundary is that **EngineeringRules are prepared/pinned inputs to
the pipeline**. Planner and Investigator do not discover legal rules themselves.
Runtime Interview gathers Customer-confirmed context before technical planning
begins and handles targeted clarification only through Orchestration.

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

- Customer-confirmed Interview context;
- assessment state;
- repository/Program Evidence Graph evidence;
- approved legal corpus and EngineeringRules;
- deterministic evaluation outcomes;
- report/audit artifacts.

The project intentionally does **not** define root `memory.py`. Managed Deep
Agents deployment-shared long-term memory is therefore not used for tenant or
assessment data. This absence is the MDA memory declaration and the LCSP
API/database remains the authority boundary.

### Todos

Deep Agents v0.7+ makes todo planning opt-in. The root installs one
`TodoListMiddleware`, exposing `write_todos` to the supervisor.

Todos mirror pipeline progress. Subagents do not own independent pipeline todo
lists; each child receives one bounded stage, returns one compact handoff, and the
root updates the supervisor todo state.

## Canonical flow

```text
initial_interview
→ CONTEXT_READY
→ plan
→ investigate
→ [NEEDS_BUSINESS_CONTEXT → targeted_interview → orchestration validation → resume investigator]*
→ deterministic gate
→ gap
→ report
```

The supervisor follows this sequence through `instructions.md` and delegates with
Deep Agents' native `task` tool. LCSP does not maintain a second transition engine
beside the Deep Agent/LangGraph runtime.

`NEEDS_BUSINESS_CONTEXT` and `resume` are orchestration states. The deterministic
gate is not a subagent and cannot be called as a model tool.

## Specialized subagents

Each subagent has an independently reviewable definition:

```text
subagents/
├── planner/
│   └── definition.py
└── investigator/
    └── definition.py
```

Every definition declares its own:

- name and delegation description;
- model;
- system prompt;
- minimal authored tool set;
- runtime-context middleware;
- output contract.

### Planner

Runs only after runtime Interview produces `CONTEXT_READY`.

Tools:

- `search_program_graph`
- `get_scan_coverage`

Responsibilities:

- consume the fixed PipelineContext and EngineeringRules;
- create the smallest technical investigation scope;
- identify graph seeds and coverage limitations;
- return `INVESTIGATE` or a precise `NEEDS_INPUT`.

Planner cannot retrieve legal basis, reload Interview context, change the active rule
set, or decide compliance.

### Investigator

Runs after Planner, or after Orchestration validates a targeted Interview
continuation for the same plan.

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
- return one exact `NEEDS_BUSINESS_CONTEXT` when required.

Investigator cannot fetch Interview/legal context, change EngineeringRules, or emit
`COMPLIANT`, `NON_COMPLIANT`, or `UNKNOWN`.

## Model policy

Defaults live in `model_policy.py` and can be overridden by deployment env vars.

| Role | Default model | Workload |
| --- | --- | --- |
| Root orchestrator | `openai:gpt-5-nano` | coordination, delegation, todo/state management |
| Legal triage | `openai:gpt-5-nano` | legal work-item triage |
| Interview | `openai:gpt-5-nano` | Customer business-context reasoning and clarification |
| Planner | `openai:gpt-5-nano` | high-reasoning scope construction |
| Investigator | `openai:gpt-5-nano` | repeated tool-heavy technical investigation |
| Narrators/proposers | `openai:gpt-4.1-nano` | bounded narration and proposal fields without reasoning kwargs |

OpenAI `provider:model` specs are constructed through an LCSP provider profile
that explicitly sets the Responses API client contract:
`use_responses_api=True` and `output_version="responses/v1"`. Reasoning is not
enabled merely because the provider is OpenAI. LCSP attaches
`reasoning={"effort": ...}` only when both conditions are true:

1. the agent role is a reasoning owner (`root`, `triage`, `interview`, `planner`,
   `investigator`, `lcsp-legal-chunk-triage`, `lcsp-engineering-rule-compiler`,
   `lcsp-engineering-rule-planner`, `law_guided_investigator`, or
   `lcsp-investigator-durable-execution`);
2. the model is an OpenAI reasoning-capable model such as `gpt-5-mini`,
   `gpt-5.1`, `gpt-5.6-*`, or an o-series reasoning model.

Non-reasoning narrators/proposers omit reasoning even when their model is OpenAI:
`lcsp-final-report-narrator`, `lcsp-classification-rationale-narrator`,
`lcsp-classification-proposer`, and `lcsp-ai-usage-flow-proposer`. Overrides to
non-reasoning models such as `openai:gpt-4.1-nano` also omit reasoning regardless
of whether the Responses API or Chat Completions path is used. Reasoning effort
defaults to `low` and can be overridden with `LCSP_REASONING_EFFORT` (with
legacy aliases retained for deployment compatibility). LCSP does not request
reasoning summaries and does not expose hidden chain-of-thought.

Select all role models together with a code-owned preset:

```env
LCSP_MODEL_PROVIDER=openai
# Or: LCSP_MODEL_PROVIDER=google_genai
```

OpenAI uses GPT-5 nano with low reasoning for reasoning roles and GPT-4.1 nano
for narrators/proposers. Google uses Gemini 3.5 Flash-Lite for every role:
reasoning roles receive `thinking_level="low"`; narrators/proposers receive `"minimal"`.
Minimal reduces thinking but does not guarantee zero thinking tokens.
The exact Google harness profile supports the reasoning root and subagents;
narrators/proposers use the agent-scoped constructor with minimal thinking.

An explicit provider preset takes precedence over legacy per-role model and
reasoning environment variables. Unset `LCSP_MODEL_PROVIDER` to retain legacy
per-role overrides. Unknown preset names fail at startup. Restart the worker
after switching. This selects a provider at startup; it is not automatic
failover/replay after an API error. Configure credentials for the selected provider.

All role models receive the same LCSP harness profile.

## Agent-facing tool hierarchy

Authored model-callable tools remain physically under `tools/`:

```text
tools/
├── common/
├── planner/
├── investigator/
└── orchestration/
```

Physical tool ownership and subagent exposure are intentionally separate. A tool
being in `tools/common` does not mean every subagent receives it; each native
subagent definition owns its exact `tools` list.

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
Interview → Planner → Investigator
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

LLM agents plan and investigate. Runtime Interview and Orchestration own Customer
context clarification. Deterministic LCSP code owns claim validation,
EngineeringRule evaluation, gap derivation boundaries, and the final authority
trail.

## Terminal schema failures

Schema/type validation failures stop the affected task immediately. Shared model
governance rejects structured-output repair messages and tool-argument validation
messages before another model call. Native provider validation errors, Pydantic
validation errors, TypeError, and HTTP 400/404/422 request rejection are non-retryable,
including when wrapped by another exception. Transient model retries remain bounded
at two retries. RabbitMQ rejects terminal deliveries with requeue disabled (dead
lettering follows the queue's configured policy), and waiting-assessment reconciliation
does not register terminal failures for automatic resume. Correct the schema/config
before explicitly submitting a new task. Existing running workers need a restart.

## Same-provider token fallback

The selected provider can use an ordered comma-separated API key list:

```env
LCSP_MODEL_PROVIDER=openai
OPENAI_API_KEY=token1,token2,token3,
# For Google instead:
# LCSP_MODEL_PROVIDER=google_genai
# GOOGLE_API_KEY=token1,token2,token3,
```

Google also accepts `GEMINI_API_KEY` when `GOOGLE_API_KEY` is unset. Whitespace,
empty entries and duplicate keys are removed; a non-empty list containing only
commas/whitespace is invalid. A single key retains normal SDK behavior.

For multiple keys, each model call tries keys in order on HTTP 401/403/429
(including wrapped provider errors). SDK retries are disabled for these lists.
The model, provider, reasoning/thinking settings, tools, and input stay the same.
Schema/type errors and HTTP 400/404/422 stop immediately without trying another key.
Exhausting the list stops the task without model retry, queue requeue, or automatic
waiting-assessment resume. Completed tool operations are not replayed by token
fallback. Token values are never included in fallback diagnostics. Restart workers
after changing the environment. This is credential fallback, not data rollback.
