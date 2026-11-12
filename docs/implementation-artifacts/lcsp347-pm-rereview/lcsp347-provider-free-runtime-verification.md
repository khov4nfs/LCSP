# LCSP-347 DATA-04.1: provider-free runtime verification

## Root cause

`deepagents/agent.py` constructs the root model while building the graph, before a trusted system event reaches `dispatch_agent_runtime_system_event`. The system-event middleware dispatches the event and jumps to `end` before the model turn, but the normal Agent Server still initializes its configured model at startup. The default route configuration includes remote providers and fallbacks, so starting without credentials fails closed rather than providing a usable server.

The DATA-04 attempt to start with a local-only route and loopback guard was rejected at the command execution authorization boundary. The durable handoff records that refusal category, but not the exact rule/subcode or refusal text. This was not an application route-validation failure, an observed Agent Server startup exception, or an observed egress denial. The earlier no-credential startup separately failed because the default OpenAI route had no credentials. No alternate launch route was attempted.

## Fix and verification

No production routing or execution policy was changed. A deterministic in-process graph regression was added: a trusted `managed_document_ingest_requested` event reaches the boundary dispatch stub, ends through the system-event hook, and leaves the injected `ScriptedModel.prompts` empty. This proves dispatch-before-inference mechanics in an in-process graph using a fake model. It does **not** establish that Agent Server starts without provider access.

Command from `deepagents`:

```powershell
uv run --frozen pytest -q --tb=short tests/test_agent_runtime_health_boundary.py tests/test_system_event_dispatch_async.py tests/test_model_routes.py tests/test_managed_document_ingest.py
```

Result: **302 passed, 1 expected malformed-DOCX fixture warning, 11.19s**. Tests use local fakes and fixtures; no live Agent Server, external model transport, or real broker was exercised.

## Provider-free preflight

| Check | Result | Evidence |
|---|---|---|
| M01 real Agent Server initializes | BLOCKED | Prior no-credential launch failed closed; local-only launch rejected by execution authorization |
| M02 all instantiated routes/fallbacks are local-only | NOT_PROVEN | No live process/client graph; default routes include remote providers/fallbacks |
| M03 no provider credentials inherited by a live worker | NOT_PROVEN | No worker started |
| M04 managed-document event avoids inference | PARTIAL | In-process graph test passes with injected fake model |
| M05 unexpected inference is rejected and counted | NOT_PROVEN | No live local transport/guard exercised |
| M06 invalid route config fails closed | PASS, unit-level | Model-route validation tests in the 302-test command |
| M07 retry cannot change route configuration | NOT_PROVEN live | No worker/server replay under an isolated route |
| M08 test event gains no Activation/Assessment/Preparation authority | PASS by test scope | Only managed-document event dispatch was stubbed; no such workflow was invoked |
| M09 external model egress is blocked | NOT_PROVEN | No live runtime or network isolation proof |
| M10 sanitized runtime audit identity | PARTIAL | Test identity only; no process receipt |

## Required operator action

An authorized platform/runtime operator must permit the normal Agent Server entrypoint in an isolated test environment with a supported local-only route, no remote credentials, and verified provider egress denial (or provide a sanctioned provider-free Agent Server integration harness). The authorization must be granted through the execution-control layer. Do not send credentials in chat or change production routing. Repeat M01–M10 before creating a DRAFT or publishing an ingestion event.
