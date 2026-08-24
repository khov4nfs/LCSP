# FOGEWISE_AGENT.md

Project-specific deployment rules for Fogewise production.

Read `.fogewise/README.md` before changing deployment topology.

## Source of truth

- `.fogewise/deploy.yml` is the single source of truth for Fogewise topology.
- `.fogewise/README.md` documents the current Fogewise Deploy v2 contract and LCSP topology.
- Do not add Fogewise metadata to `package.json`.
- Do not commit repository-owned production Compose files.
- Do not put application secrets, env variable names, internal URLs, image tags, host ports, registry credentials, or build arguments in `deploy.yml`.

## Manifest contract

```yaml
services:
  <service-id>:
    path: <repo-relative-path>
    route: <optional-public-route>
    requires:
      - <optional-platform-dependency>
    command:
      - <optional-runtime-command-arg>
```

Semantics:

- `path` selects the Docker build unit. CI resolves `<path>/Dockerfile` with repository root as build context.
- `route` is optional. When present, the service is public through Caddy.
- `requires` attaches the service to approved Fogewise shared infrastructure such as `redis` or `rabbitmq`.
- `command` is an optional Docker CMD override. Image `ENTRYPOINT` remains active.

Do not add `type`, `port`, `hostPort`, `dockerServiceName`, `runtimeEnv`, `buildEnv`, or similar metadata.

## Public and internal service rule

```text
route present
  -> public HTTP service
  -> container target 8080
  -> dynamic 127.0.0.1:<host-port>
  -> Caddy route generated

route absent
  -> internal/background service
  -> no host port published
  -> no Caddy route generated
```

This rule is generic. Fogewise does not need to know whether a service is Node.js, Python, a worker, or another runtime.

## LCSP topology

For LCSP, only `web` is public.

```text
Internet -> Caddy -> web:8080
                    |
                    +-> api:8080

api/managed-deep-agent <-> fogewise-rabbitmq
api                    <-> fogewise-redis
managed-deep-agent      -> api:8080
```

The NestJS `api` service intentionally has no public `/api` Fogewise route because Next.js owns the public `/api/*` BFF routes and calls NestJS internally through Docker DNS.

The Managed Deep Agent service uses `path: deepagents` and the image `ENTRYPOINT` (`mda dev .`). It remains internal and must not publish host ports. Do not reintroduce separate `ConsumerBase` worker services for scanner, assessment, reporting, targeted reanalysis, or legal-corpus jobs.

`audit-export` is not an active Fogewise worker in the current MVP topology.

## Build and image rules

Production images are built by GitHub Actions, not by the VPS.

```text
push main
  -> GitHub Actions reads deploy.yml
  -> build images
  -> push immutable SHA tags to GHCR
  -> upload deploy.yml
  -> VPS pulls images
  -> generated Compose starts containers
  -> Fogewise waits for readiness
  -> Fogewise resolves public dynamic ports
  -> Fogewise regenerates/reloads Caddy
```

Image convention:

```text
ghcr.io/<owner>/<repo>-<service-id>:<git-sha>
```

Services sharing the same `path` should be built once by CI and tagged for the service IDs that consume that build unit.

The VPS must never build application images and must not need application source code.

## Runtime rules

Runtime directory:

```text
/srv/apps/<repo>/
  .env
  .fogewise/
    deploy.yml
```

Expected permissions:

```text
/srv/apps/<repo>                      root:root 0700
/srv/apps/<repo>/.env                 root:root 0600
/srv/apps/<repo>/.fogewise            root:root 0755
/srv/apps/<repo>/.fogewise/deploy.yml root:root 0644
```

Generated state:

```text
/var/lib/fogewise/apps/<repo>/compose.json
/var/lib/fogewise/apps/<repo>/release.json
```

Generated Caddy site:

```text
/etc/caddy/conf.d/<repo>.caddy
```

Do not use `/etc/caddy/sites-enabled`.

## Networking

All services in one application share the generated application network and therefore use service IDs as Docker DNS names.

Examples of application-owned production env values:

```text
LCSP_API_BASE_URL=http://api:8080
NESTJS_API_BASE_URL=http://api:8080
```

Fogewise does not inject those env names. It only guarantees service DNS/network topology.

`requires: [redis]` and `requires: [rabbitmq]` attach a service to `fogewise-network`. Shared infrastructure connection URIs remain application-owned env configuration.

## Health and readiness

Fogewise Deploy v2 behavior:

- image has Docker `HEALTHCHECK` -> wait for `healthy`;
- image has no Docker `HEALTHCHECK` -> wait for `running`;
- public service -> also resolve and verify its dynamic loopback TCP port before rendering Caddy.

Python workers expose `/health` on container port `8080` through their Docker health check only. That port must not be published publicly.

## Secrets and logs

- Never print `/srv/apps/<repo>/.env`.
- Never stream resolved Compose configuration containing env values.
- Use `docker compose config --quiet` for validation.
- Do not enable shell xtrace around credentials.
- GHCR credentials are ephemeral platform credentials, not application env.
- Raw server deployment logs, when retained, must remain root-only mode `0600`.

## Caddy

Fogewise writes:

```text
/etc/caddy/conf.d/<repo>.caddy
```

The platform Caddyfile must import:

```text
import /etc/caddy/conf.d/*.caddy
```

Generated site files must be `0644`.

For v1-style manifests with routes such as `/api` and `/`, more-specific routes must be rendered before `/`, and `/api` must not be stripped unless the application contract explicitly requires it.

## Required deployer

LCSP requires `fogewise-deploy` v2 or newer:

```bash
/usr/local/sbin/fogewise-deploy --version
```

Do not deploy the current LCSP manifest with a v1 deployer that requires every service to have `route`.

Fogewise Deploy v2 must remain backward-compatible with projects such as `tasks-dash` where all declared services are public and use v1-style `path + route + requires` entries.

## Change discipline

- Keep `deploy.yml` minimal.
- Do not add worker-specific Fogewise metadata.
- Do not reintroduce source rsync or VPS-side application builds.
- Do not add fixed host ports.
- Do not expose background workers through Caddy.
- When topology or Fogewise semantics change, update both `deploy.yml` and `.fogewise/README.md` in the same PR.
