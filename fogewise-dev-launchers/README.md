# Fogewise Dev Launchers v8

Đã tách theo hệ điều hành để developer nhìn vào là biết chạy file nào.

```text
fogewise-dev-launchers/
├── common/
│   ├── Caddyfile.dev
│   ├── Caddyfile.production
│   └── .fogewise-production.example
│
├── fedora/
│   ├── fogewise-dev-fedora.sh
│   ├── fogewise-local-reset-fedora.sh
│   ├── fogewise-production-fedora.sh
│   ├── Fogewise Dev.desktop
│   ├── Fogewise Local Reset.desktop
│   └── Fogewise Production.desktop
│
├── macos/
│   ├── fogewise-dev-macos.command
│   ├── fogewise-local-reset-macos.command
│   └── fogewise-production-macos.command
│
├── windows/
│   ├── fogewise-dev-windows.bat
│   ├── fogewise-dev-windows.ps1
│   ├── fogewise-local-reset-windows.bat
│   ├── fogewise-local-reset-windows.ps1
│   ├── fogewise-production-windows.bat
│   └── fogewise-production-windows.ps1
│
├── docs/
│   ├── FOGEWISE_LOCAL_DEV_GUIDE.md
│   └── FOGEWISE_TUNNEL_ADMIN_SETUP.md
│
└── README.md
```

## Config local vẫn nằm ở root launcher

Các config máy developer không nằm trong folder OS:

```text
fogewise-dev-launchers/.fogewise-dev.local
fogewise-dev-launchers/.fogewise-production.local
```

Như vậy đổi OS/folder script không tạo thêm nhiều nguồn config.

## Fedora

Local:

```bash
./fedora/fogewise-dev-fedora.sh
```

Local infra (RabbitMQ + Redis for LCSP host development):

```bash
./fedora/fogewise-local-infra-fedora.sh
```

Reset:

```bash
./fedora/fogewise-local-reset-fedora.sh
```

Reset local infra:

```bash
./fedora/fogewise-local-infra-reset-fedora.sh
```

Production Preview:

```bash
./fedora/fogewise-production-fedora.sh
```

Hoặc dùng 3 file `.desktop` trong `fedora/`.

## macOS

Local:

```text
macos/fogewise-dev-macos.command
```

Reset:

```text
macos/fogewise-local-reset-macos.command
```

Production Preview:

```text
macos/fogewise-production-macos.command
```

## Windows

Local:

```text
windows\fogewise-dev-windows.bat
```

Reset:

```text
windows\fogewise-local-reset-windows.bat
```

Production Preview:

```text
windows\fogewise-production-windows.bat
```

Developer bình thường chỉ cần double-click `.bat`; `.ps1` là implementation.

## Luồng

```text
Local Dev
  -> domain production override về 127.0.0.1
  -> Caddy local
  -> stop thì xóa hosts override
  -> domain quay lại production

Production Preview
  -> không sửa hosts
  -> Caddy localhost:18080
  -> Cloudflare Tunnel token riêng
  -> {project}-{developer}.fogewise.io.vn

Local Reset
  -> dọn stale Caddy/hosts nếu máy crash hoặc process bị kill cứng
```

Production Preview vẫn dùng token do admin provision trước. Developer không cần quyền Cloudflare zone.

Chi tiết:
- `docs/FOGEWISE_LOCAL_DEV_GUIDE.md`
- `docs/FOGEWISE_TUNNEL_ADMIN_SETUP.md`

> v8 vẫn giữ local routing theo `.fogewise-dev.local`; chưa chuyển topology local sang `.fogewise/deploy.yml`.


## Production Preview network transport

Production Preview ép `cloudflared` dùng HTTP/2 + IPv4:

```bash
cloudflared tunnel --protocol http2 --edge-ip-version 4 run --token <TOKEN>
```

Lý do: một số mạng developer/Windows không pass ổn định khi `cloudflared` tự chọn QUIC hoặc IPv6. Ép HTTP/2 + IPv4 giúp tunnel nhận request/body ổn định hơn trong môi trường team hiện tại.
