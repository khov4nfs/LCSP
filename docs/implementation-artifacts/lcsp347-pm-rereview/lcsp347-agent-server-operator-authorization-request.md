# LCSP-347 DATA-04.2 — Agent Server operator authorization request

## Request status

**Authorization requested; not granted or evidenced.** No Agent Server was launched for this task. The DATA-04.1 receipt records `COMMAND_EXECUTION_AUTHORIZATION` as the rejecting layer and `NOT_CAPTURED_IN_DURABLE_EVIDENCE` for the refusal text. Therefore:

```yaml
COMMAND_AUTHORIZATION_LAYER: COMMAND_EXECUTION_AUTHORIZATION
REFUSAL_SUBCODE: NOT_CAPTURED
OPERATOR_APPROVAL: NOT_GRANTED
LIVE_INGESTION: BLOCKED_BY_EXECUTION_AUTHORIZATION
```

The exact denied command line and any platform rule identifier were not retained. This request does not represent that the platform has approved a command or that any model route is safe to run.

## Why approval is needed

The normal graph constructs its root model in `deepagents/agent.py` before `dispatch_agent_runtime_system_event` handles a managed-document event. The system-event middleware dispatches the recognized boundary and jumps to the end before a model turn, but model construction still happens during graph initialization. The committed default route file points to remote model providers and has fallback routes. An earlier no-credential startup failed closed; the local-only startup attempt was rejected by command execution authorization. No retry through a different launcher is requested.

## Exact scope requested

The platform/runtime operator is asked to authorize **one bounded, supervised development session** for the normal Agent Server command documented in the repository README:

```text
uv run --extra dev langgraph dev --no-browser --no-reload --allow-blocking
```

Requested working directory:

```text
D:\FPT\LCSP-347-SQUASH\deepagents
```

This is the supported local development entrypoint, not the custom production server. The exact process executable resolved by `uv`/the environment was not captured in the earlier refusal. Before a grant is applied, the operator should bind it to the actual resolved `uv` and `langgraph` executables, this working directory, the arguments above, and the environment values listed below. Do **not** grant unrestricted PowerShell, shell, subprocess, container, or network execution.

The refusal mechanism's user-facing approval channel is platform-owned and not documented in this repository. The operator must use the platform's normal execution-control approval flow and attach the grant to this exact request. No permission API or rule name is assumed here.

## Required isolated runtime configuration

The operator must provision and review a test-only environment file and route file outside Git. Resolve current endpoints at approval time; historical port numbers are not proof of the current service identity.

| Setting | Required scope |
|---|---|
| `LCSP_MODEL_ROUTES_FILE` | Explicit operator-reviewed test route file. Its complete role and fallback graph must be local-only or otherwise demonstrably unable to reach a paid provider. The committed default route file is not acceptable for this run. |
| `NESTJS_API_BASE_URL` | One independently verified disposable Legal Source API only. Loopback/local test network; no shared, staging, or production API. |
| `LCSP_API_BASE_URL` | Same isolated API where used by runtime components. |
| `LANGGRAPH_CHECKPOINT_DATABASE_URL` | Disposable checkpoint database isolated from production and historical LCSP snapshots. |
| `RABBITMQ_URL` | Isolated broker vhost only (intended DATA-04 test vhost `/lcsp-data04`, subject to fresh identity and queue preflight). Never `/lcsp-data032` or a shared broker. |
| `LCSP_AGENT_RUNTIME_RABBITMQ_QUEUE_PREFIX` | One reviewed task-specific prefix with only its intended bindings. |
| `WORKER_API_KEY` | Test-only worker identity, provided through an approved local secret store; not copied into logs or this request. |
| Provider credentials | None. Remove inherited provider credentials from both Agent Server and worker processes. |

No live endpoints, credentials, route values, or database secrets are embedded in this request. The intended isolated database was previously named `lcsp_data04_corpus`; its current identity, emptiness, schema, ownership, storage and availability must be reverified before any write. No database or broker writes are part of the authorization requested here.

## Network boundary required before launch

The operator must enforce egress outside the application process so a fallback or unexpected SDK request cannot bypass application checks.

1. Deny outbound Internet access from the Agent Server and Python worker, including DNS paths that could resolve provider hosts.
2. Deny provider endpoints and provider SDK traffic, including the configured/known Inception, APX, Mirai, OpenAI, Anthropic and Google GenAI endpoints. The committed provider map identifies `api.inceptionlabs.ai`, `api.apmix.ai`, and `api.miraiapi.com`; native SDK endpoints must also be denied. Deny all unlisted egress by default.
3. Permit only the explicitly resolved local/test API, isolated PostgreSQL checkpoint/data services, isolated RabbitMQ vhost transport, and a reviewed loopback model stub if the operator has independently approved that architecture.
4. Record firewall/egress rule identity and a negative connectivity test for each provider class before starting ingestion. A missing credential, placeholder key, local route name, or zero usage rows is not egress proof.
5. Do not change global host firewall policy or production routing as part of this session.

The current route implementation supports six provider identities (`openai`, `anthropic`, `google_genai`, `inception`, `apx`, `miraiapi`). Inception and APX expose environment-selected base URL functions, while Mirai has a fixed base URL; OpenAI, Anthropic and Google use native client defaults. The repository does not establish a sanctioned local model stub route. A local endpoint must not be treated as approved solely because a URL points to loopback.

## Allowed process and authority boundary

The single authorized server process may initialize the LCSP graph and serve the managed-document system-event path. A separately scoped, test-only Python consumer may be started only after the server/network preflight has passed and after a second explicit operator action approves the ingestion event. This request by itself does **not** authorize creating a Legal Source, creating a DRAFT, uploading documents, publishing outbox events, starting the consumer, or processing a document.

If the later ingestion stage is separately approved, the only permitted domain execution is managed-document ingestion into one newly created DRAFT. Source activation, Rule Set Preparation, Assessment and all model inference remain prohibited.

## Preconditions and evidence for successful verification

Before graph launch, record sanitized identities for the operator grant, resolved executable, command hash/arguments, working directory, environment-file hash, route-file hash, network policy, API/database/broker identities, and expiry. Do not record secret values.

For runtime approval to be considered technically usable, the separately approved preflight must demonstrate:

- Agent Server startup via the exact command above.
- Resolved root route, every route reachable through fallback, and every initialized model client.
- No provider credentials inherited by the process tree.
- External-provider egress blocked at the enforced network layer, with negative connectivity evidence.
- Unexpected inference denied and observable by a test-only rejecting local transport or equivalent guard.
- API, checkpoint and broker all resolve only to the isolated test environment.
- Managed-document event dispatch succeeds without an inference request.
- The only consumer subscription is the task-scoped queue prefix.
- No activation, Preparation or Assessment authority is available to the test action.

The existing in-process fake-model test is only unit evidence; it is not a live server, client-transport or egress proof.

## Immediate shutdown triggers

Terminate the server and do not publish/consume an event if any of these occurs:

- The exact command/workdir differs from the approved grant.
- A route or fallback resolves to a remote provider, a route is unknown, or a client initializes with an unexpected provider identity.
- Any provider credential appears in the process environment.
- A provider endpoint is reachable or an inference attempt escapes the rejecting test boundary.
- API, database, checkpoint or broker identity cannot be proved to be the approved disposable target.
- An unexpected queue binding/message or non-managed-document event is present.
- The server attempts activation, Preparation, Assessment, migration or other unauthorized write.
- Process identity, logs, or persisted state cannot be audited without exposing secrets or source contents.

On shutdown, stop new task intake first, drain the supervised process under its supported shutdown behavior, preserve unsettled task evidence, and revoke the operator grant. Do not purge queues or rewrite task state.

## Expiry and revocation

Requested grant duration: one supervised session, capped at **60 minutes**, with no automatic renewal. The grant must expire on the earliest of: 60 minutes, completion of the approved preflight, operator revocation, an immediate-shutdown trigger, or termination of the approved process. The operator should revoke it immediately after preflight. A separate approval is required for any subsequent corpus write or worker execution. The platform must record grant owner, scope, start, expiry and revocation in its own audit system.

## Separate architecture proposal

A sanctioned provider-free Agent Server integration harness could avoid constructing a remote model client for a pure ingestion event. This is a separate product/runtime design proposal requiring platform/security review; it is not implemented or used as a workaround for the denied command.
