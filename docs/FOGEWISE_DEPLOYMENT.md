# Fogewise deployment for LCSP

LCSP uses the Fogewise manifest as the deployment topology source.

## Topology rules

- `path` selects the Dockerfile/build unit.
- `route` is optional. A service with a route is public through Caddy; a service without a route is internal/background only.
- `requires` attaches the service to shared Fogewise infrastructure networks.
- `command` is an optional Docker runtime command override.
- `environment` is an optional non-secret scalar environment map. Values may
  reference VPS-owned secrets such as `${LANGGRAPH_CHECKPOINT_DATABASE_URL}` or
  Fogewise-generated image aliases such as `${FOGEWISE_IMAGE_AGENT_RUNTIME}`.
- `dockerSocket: true` mounts the host Docker socket into trusted LCSP runtime
  infrastructure services only. It must never be propagated into per-assessment
  repository sandbox containers.
- HTTP services listen on container port `8080` by platform convention. The
  internal LCSP Agent Server is an explicit exception: it listens on port `8000`
  and exposes only its Docker `HEALTHCHECK`, not a public route.
- Services without a public route must not publish a host port and must not generate a Caddy route.

For LCSP, only the Next.js `web` service is public. The NestJS `api` is internal because the web application owns the public `/api/*` BFF routes and forwards to NestJS over Docker DNS.

```text
Internet -> Caddy -> web:8080
                    |
                    +-> api:8080

api -> fogewise-rabbitmq
agent-runtime -> fogewise-rabbitmq
agent-runtime -> agent-runtime-server:8000
agent-runtime-server -> api:8080
agent-runtime-server -> fogewise-postgres
```

## Required production environment

The VPS runtime env stays at `/srv/apps/lcsp/.env` and must remain root-owned mode `0600`.
The LCSP Agent Runtime receives explicit environment variables from the process
supervisor; already-injected process environment variables still win.

At minimum, deployment-specific service addresses should follow the internal Docker topology:

```env
PORT=8080
LCSP_API_BASE_URL=http://api:8080
NESTJS_API_BASE_URL=http://api:8080
RABBITMQ_URL=amqp://<credential>@fogewise-rabbitmq:5672/
HEALTH_PORT=8080
LANGGRAPH_CHECKPOINT_DATABASE_URL=postgres://<credential>@fogewise-postgres:5432/lcsp_langgraph
```

Keep credentials only in the VPS env/secret store. Do not commit production credentials.

In local development, `scripts/run.mjs` passes the repository `.env` into child
processes while explicitly disabling LangSmith tracing unless
`LCSP_LANGSMITH_TRACING=true` is set. Python runtime code does not require
LangSmith-managed sandbox credentials.

## LCSP Agent Runtime

`deepagents` is now a native Deep Agents / LangGraph project. It exports root
`agent.py`, project `tools/`, `skills/`, `schedules/`, and `evals/` through
`langgraph.json`. Local/dev images run the LCSP entrypoint, which starts the
LangGraph development server and the RabbitMQ event bridge.

Fogewise production runs two internal agent services:

```text
agent-runtime
  -> RabbitMQ event bridge
  -> http://agent-runtime-server:8000

agent-runtime-server
  -> LCSP-owned LangGraph HTTP runtime
  -> exported lcsp-agent graph
  -> Docker repository sandbox manager
```

`agent-runtime-server` is built from `deepagents-langgraph/Dockerfile`, which
uses a plain Python base image, installs the LCSP Python runtime plus Docker CLI,
and runs `tools.common.capabilities.agent_runtime.local_server`. It receives
`LANGGRAPH_CHECKPOINT_DATABASE_URL`, API service URLs, and
`LCSP_REPOSITORY_SANDBOX_IMAGE` from the Fogewise manifest/environment. The
manifest declares `requires: [postgres]` so the service is attached to the
Fogewise shared infrastructure network that resolves `fogewise-postgres`; do not
replace this with an unrelated Redis/RabbitMQ dependency just to obtain network
attachment. The
repository sandbox image is the immutable GHCR image for the `agent-runtime`
service on the same release, exposed by the deployer as
`${FOGEWISE_IMAGE_AGENT_RUNTIME}`.

`agent-runtime` is built from `deepagents/Dockerfile` and starts the LCSP
entrypoint with `LCSP_AGENT_RUNTIME_ROLE=bridge`. That role runs only the
generic RabbitMQ event bridge and the stale sandbox reaper. It does not start a
second Agent Server.

`ecosystem.config.cjs` and `redeploy.sh` remain manual PM2 repair tooling for
non-Fogewise hosts. They are not the production authority for Fogewise
deployments.

Former queue consumers are exposed through the Agent Runtime invocation manifest
in `tools.common.capabilities.agent_runtime.invocation`. Do not deploy separate
`ConsumerBase` processes for scanner, assessment, reporting, or legal corpus
jobs.

NestJS still owns durable outbox rows and publishes every async command/event to
RabbitMQ with `routingKey = eventType`. The LCSP Agent Runtime runs one generic
RabbitMQ event bridge alongside the LangGraph server. That bridge derives its
queue bindings from the Agent Runtime invocation manifest and dispatches
messages into the matching boundary. Do not add API-side runtime routing
predicates for individual events.

The entrypoint also starts a repository sandbox reaper. By default it removes
LCSP-owned Docker sandboxes older than 24 hours and repeats hourly. Operators can
override this with `LCSP_REPOSITORY_SANDBOX_TTL_SECONDS`,
`LCSP_REPOSITORY_SANDBOX_REAPER_INTERVAL_SECONDS`, or disable it with
`LCSP_REPOSITORY_SANDBOX_CLEANUP_ON_START=false` for controlled maintenance
windows.

## Fogewise deployer compatibility

This manifest requires Fogewise deployer support for:

1. optional `route`;
2. optional `command` string list;
3. optional non-secret `environment` scalar maps with VPS-secret expansion;
4. `${FOGEWISE_IMAGE_<SERVICE_ID>}` image alias expansion for declared services;
5. `dockerSocket: true` for trusted internal runtime services;
6. no host port for services without a route;
7. no Caddy route for services without a route;
8. waiting for Docker `HEALTHCHECK` when an image provides one;
9. shared external networks declared by `requires`.

Do not merge/deploy this manifest against an older deployer that requires every
service to have a public route or does not support the agent runtime fields.

The generic VPS program at `/usr/local/sbin/fogewise-deploy` is infrastructure outside this repository. This branch prepares the LCSP side and the reusable GitHub workflow, but the VPS deployer must be upgraded to the semantics above before the branch is deployed to production.

## CI image builds

The reusable workflow groups services by `path`. The RabbitMQ bridge and
repository sandbox image are built from `deepagents` as `agent-runtime`. The
LCSP Agent Server image is built from `deepagents-langgraph` as
`agent-runtime-server`. It is not based on `langchain/langgraph-api` and does
not require LangGraph Platform or LangSmith entitlement to start. Former
per-consumer worker images must not be reintroduced.

The final deployment health check runs from the VPS against Caddy on loopback
with the production Host/SNI, so Cloudflare edge policy is not part of the
deployment success criterion.
