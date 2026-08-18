# Fogewise Production Preview — Admin Provisioning

Production Preview v7 uses an admin-provisioned Cloudflare Tunnel token.

Developers do not need Cloudflare zone access.

## Convention

One project × one developer = one tunnel.

Example:

```text
Project      : tasks-dash
Developer    : minh
Tunnel name  : fogewise-tasks-dash-minh
Public host  : tasks-dash-minh.fogewise.io.vn
Origin       : http://127.0.0.1:18080
```

## Admin setup

Create the tunnel in Cloudflare and configure its public hostname to the developer's preview hostname.

The tunnel origin must point to:

```text
http://127.0.0.1:18080
```

Then copy the tunnel run token and send only that token to the developer through a secure channel.

The developer stores it in:

```text
fogewise-dev-launchers/.fogewise-production.local
```

Example:

```env
FOGEWISE_DEV_SLUG=minh
FOGEWISE_SHARE_PORT=18080
FOGEWISE_PREVIEW_HOST=tasks-dash-minh.fogewise.io.vn
FOGEWISE_TUNNEL_TOKEN=<tunnel-token>
```

Do not commit that file.

## Important

Do not share one tunnel token between multiple developers.

Use a separate tunnel/token per project + developer so preview traffic always reaches the intended developer machine.

If a token is exposed, rotate only that tunnel token.


---

## v8 folder layout

Scripts are grouped under `fedora/`, `macos/`, and `windows/`. Shared Caddy files are under `common/`. Local config files remain at the `fogewise-dev-launchers/` root.
