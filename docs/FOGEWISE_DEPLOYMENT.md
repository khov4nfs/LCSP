# Fogewise deployment for LCSP

LCSP uses the Fogewise manifest as the deployment topology source.

## Topology rules

- `path` selects the Dockerfile/build unit.
- `route` is optional. A service with a route is public through Caddy; a service without a route is internal/background only.
- `requires` attaches the service to shared Fogewise infrastructure networks.
- `command` is an optional Docker runtime command override.
- HTTP services listen on container port `8080` by platform convention.
- Services without a public route must not publish a host port and must not generate a Caddy route.

For LCSP, only the Next.js `web` service is public. The NestJS `api` is internal because the web application owns the public `/api/*` BFF routes and forwards to NestJS over Docker DNS.

```text
Internet -> Caddy -> web:8080
                    |
                    +-> api:8080

api/workers <-> fogewise-rabbitmq
workers      -> api:8080
```

## Required production environment

The VPS runtime env stays at `/srv/apps/lcsp/.env` and must remain root-owned mode `0600`.

At minimum, deployment-specific service addresses should follow the internal Docker topology:

```env
PORT=8080
LCSP_API_BASE_URL=http://api:8080
NESTJS_API_BASE_URL=http://api:8080
RABBITMQ_URL=amqp://<credential>@fogewise-rabbitmq:5672/
HEALTH_PORT=8080
```

Keep credentials only in the VPS env/secret store. Do not commit production credentials.

## Managed Deep Agent

`lcsp-python-workers` is now a Managed Deep Agents project. It uses root
`agent.py`, project `tools/`, `skills/`, `schedules/`, and `evals/` instead of
long-running consumer commands. Local/dev images run `mda dev .`; production
schedules and agent execution are managed by the deployed agent runtime.

Former queue consumers are exposed through the Managed Agent invocation manifest
in `lcsp_workers.managed.invocation`. Do not deploy separate `ConsumerBase`
processes for scanner, assessment, reporting, or legal corpus jobs.

## Fogewise deployer compatibility

This manifest requires Fogewise deployer support for:

1. optional `route`;
2. optional `command` string list;
3. no host port for services without a route;
4. no Caddy route for services without a route;
5. waiting for Docker `HEALTHCHECK` when an image provides one;
6. shared external networks declared by `requires`.

Do not merge/deploy this manifest against an older deployer that requires every service to have a public route.

The generic VPS program at `/usr/local/sbin/fogewise-deploy` is infrastructure outside this repository. This branch prepares the LCSP side and the reusable GitHub workflow, but the VPS deployer must be upgraded to the semantics above before the branch is deployed to production.

## CI image builds

The reusable workflow groups services by `path`. Services sharing `lcsp-python-workers` are built once and the resulting image is tagged for every worker service, avoiding one identical Python build per consumer.

The final deployment health check runs from the VPS against Caddy on loopback with the production Host/SNI, so Cloudflare edge policy is not part of the deployment success criterion.
