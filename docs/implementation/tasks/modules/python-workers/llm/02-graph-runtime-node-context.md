---
task_id: MW-llm-002
module: python-workers/llm
runtime: lcsp-python-workers
priority: P0
status: READY_FOR_DEV
epic_story: 7.3
depends_on:
  - python-workers/llm/01-llm-gateway-client.md
  - python-workers/classification/01-classification-worker.md
---

# Graph Runtime Node Context and Gateway Metadata

## Outcome

Extend the Python LLM Gateway contract so every model-assisted worker node sends workflow-scoped context (`workflow_run_id`, `node_name`, `correlationId`) and receives provider request metadata (`request_id`) back. This makes LangGraph-style retries, replay, and audit attribution possible without allowing direct provider calls outside the gateway.

## Module Files

| File                                                                             | Action | Notes                                                          |
| -------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| `lcsp-python-workers/src/lcsp_workers/llm/gateway_client.py`                     | Modify | Require workflow/node context and surface request metadata     |
| `lcsp-python-workers/src/lcsp_workers/classification/classification_consumer.py` | Modify | Derive graph-safe workflow context for optional rationale node |
| `lcsp-python-workers/src/lcsp_workers/classification/rationale_narrator.py`      | Modify | Pass workflow/node context into gateway calls                  |
| `lcsp-python-workers/tests/test_llm_gateway.py`                                  | Modify | Cover required workflow/node context and request metadata      |
| `lcsp-python-workers/tests/classification/test_classification_worker.py`         | Modify | Cover classification fallback with node context                |

## Business Rules

1. Every gateway call must include `workflow_run_id` and `node_name`.
2. `correlationId` remains optional but should be passed when available.
3. Gateway responses must expose provider request metadata when the provider supports it.
4. Missing workflow/node context is a caller error and must fail before any provider call.
5. Optional model-assisted nodes may fail closed or degrade gracefully according to worker policy; they must not silently bypass context requirements by making raw SDK calls.

## Test Cases

| ID  | Scenario                                                             | Expected                                                        |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| T01 | Valid gateway call with workflow/node context                        | Response includes normal content and metadata                   |
| T02 | Missing `workflow_run_id`                                            | Request rejected before provider call                           |
| T03 | Missing `node_name`                                                  | Request rejected before provider call                           |
| T04 | Classification rationale node has no explicit workflow id in message | Consumer derives stable fallback and still calls gateway safely |

## Definition of Done

- Gateway requires workflow/node context.
- Classification rationale path passes graph-safe context.
- Provider request metadata is preserved in `LLMResponse`.
- Tests cover required context and non-regression of optional rationale behavior.
