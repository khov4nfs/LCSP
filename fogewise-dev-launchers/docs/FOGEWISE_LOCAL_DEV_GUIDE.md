# Fogewise Local Development Domain Guide

> Mục tiêu: mỗi project dùng chính subdomain của project, theo dạng `https://{sub_domain}.fogewise.io.vn`.
>
> Trên máy developer, domain này được override về `127.0.0.1`, nên developer thấy code local + HMR ngay khi save. Trên thiết bị không có local override, domain vẫn resolve theo DNS public và đi tới production VPS.

---

## 1. Quy ước `{sub_domain}`

Trong tài liệu này:

```text
{sub_domain}
```

là subdomain thực tế của project.

Ví dụ:

```text
Project: tasks-dash

{sub_domain} = tasks-dash

Production:
https://tasks-dash.fogewise.io.vn

Local development trên máy dev:
https://tasks-dash.fogewise.io.vn
```

Điểm quan trọng là **URL giống nhau**, nhưng cách resolve khác nhau:

```text
Máy developer
tasks-dash.fogewise.io.vn
    -> /etc/hosts hoặc Windows hosts
    -> 127.0.0.1
    -> Caddy local
    -> local dev server

Thiết bị bình thường
tasks-dash.fogewise.io.vn
    -> DNS / Cloudflare
    -> VPS
    -> production
```

Vì vậy không dùng một domain cố định kiểu:

```text
dev.fogewise.io.vn
```

cho tất cả project.

Fogewise dùng:

```text
{sub_domain}.fogewise.io.vn
```

theo từng project.

---

# 2. Kiến trúc

Ví dụ project có:

```text
{sub_domain} = tasks-dash

Frontend dev server : 127.0.0.1:3000
Backend dev server  : 127.0.0.1:4000
```

Local flow:

```text
https://tasks-dash.fogewise.io.vn
            |
            v
local hosts override
            |
            v
        127.0.0.1
            |
            v
        Local Caddy
        /          -> 127.0.0.1:3000
        /api/*     -> 127.0.0.1:4000
            |
            v
       Local source
            |
            v
       HMR / watch mode
```

Production flow:

```text
https://tasks-dash.fogewise.io.vn
            |
            v
        Cloudflare
            |
            v
            VPS
            |
            v
      Docker / GHCR
```

Local `hosts` có độ ưu tiên cao hơn DNS public, nên trên máy dev cùng hostname đó sẽ đi về local.

---

# 3. Quy ước biến môi trường local

Để guide và `Caddyfile.dev` dùng được cho mọi project, mỗi developer đặt:

```text
FOGEWISE_SUBDOMAIN={sub_domain}
```

Ví dụ:

```text
FOGEWISE_SUBDOMAIN=tasks-dash
```

## Linux / macOS

Trong terminal đang chạy project:

```bash
export FOGEWISE_SUBDOMAIN=tasks-dash
```

Kiểm tra:

```bash
echo "$FOGEWISE_SUBDOMAIN"
```

## Windows PowerShell

```powershell
$env:FOGEWISE_SUBDOMAIN = "tasks-dash"
```

Kiểm tra:

```powershell
$env:FOGEWISE_SUBDOMAIN
```

> Thay `tasks-dash` bằng subdomain thực tế của project.

---

# 4. `Caddyfile.dev` dùng chung cho mọi project

Tạo file tại root repository:

```text
Caddyfile.dev
```

Nội dung:

```caddy
{$FOGEWISE_SUBDOMAIN}.fogewise.io.vn {
    bind 127.0.0.1

    tls internal

    @api path /api /api/*
    handle @api {
        reverse_proxy 127.0.0.1:4000
    }

    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

Caddy hỗ trợ environment variable substitution trong site address bằng cú pháp:

```text
{$FOGEWISE_SUBDOMAIN}
```

Khi:

```text
FOGEWISE_SUBDOMAIN=tasks-dash
```

Caddy sẽ parse site address thành:

```text
tasks-dash.fogewise.io.vn
```

`bind 127.0.0.1` rất quan trọng:

```text
Caddy chỉ listen trên loopback
```

Do đó máy khác trong LAN không thể truy cập local dev server này.

`tls internal` tạo certificate từ Local CA của Caddy, dùng cho HTTPS development.

Kiểm tra config:

### Linux / macOS

```bash
FOGEWISE_SUBDOMAIN="$FOGEWISE_SUBDOMAIN" \
caddy validate --config Caddyfile.dev
```

### Windows

```powershell
caddy validate --config .\Caddyfile.dev
```

---

# 5. Fedora Linux

## 5.1. Cài Caddy

```bash
sudo dnf install -y dnf5-plugins
sudo dnf copr enable -y @caddy/caddy
sudo dnf install -y caddy
```

Kiểm tra:

```bash
caddy version
```

Nếu systemd Caddy đang chạy và chiếm port 443:

```bash
sudo systemctl disable --now caddy
```

---

## 5.2. Set subdomain

Ví dụ:

```bash
export FOGEWISE_SUBDOMAIN=tasks-dash
```

Tạo biến domain:

```bash
FOGEWISE_DOMAIN="${FOGEWISE_SUBDOMAIN}.fogewise.io.vn"
```

Kiểm tra:

```bash
echo "$FOGEWISE_DOMAIN"
```

Kỳ vọng:

```text
tasks-dash.fogewise.io.vn
```

---

## 5.3. Override domain về local

Kiểm tra:

```bash
grep -F "$FOGEWISE_DOMAIN" /etc/hosts || true
```

Nếu chưa có:

```bash
echo "127.0.0.1 $FOGEWISE_DOMAIN" | sudo tee -a /etc/hosts
```

Kiểm tra lại:

```bash
grep -F "$FOGEWISE_DOMAIN" /etc/hosts
```

---

## 5.4. Ping

```bash
getent hosts "$FOGEWISE_DOMAIN"
```

và:

```bash
ping -c 3 "$FOGEWISE_DOMAIN"
```

Phải resolve về:

```text
127.0.0.1
```

Nếu ra IP public/VPS thì **không chạy tiếp**, vì local override chưa đúng.

---

## 5.5. Cho Caddy bind port 443 không cần sudo mỗi lần

```bash
sudo setcap cap_net_bind_service=+ep "$(command -v caddy)"
```

Kiểm tra:

```bash
getcap "$(command -v caddy)"
```

Kỳ vọng tương tự:

```text
/usr/bin/caddy cap_net_bind_service=ep
```

---

## 5.6. Chạy Caddy

Tại root repository:

```bash
caddy run --config Caddyfile.dev
```

Caddy nhận:

```text
FOGEWISE_SUBDOMAIN=tasks-dash
```

từ shell hiện tại.

Ở terminal khác, trust Local CA:

```bash
caddy trust
```

Nếu hệ thống yêu cầu quyền root để cài certificate vào system trust store, chạy:

```bash
sudo caddy trust
```

Test:

```bash
curl -I "https://$FOGEWISE_DOMAIN"
```

---

# 6. macOS

## 6.1. Cài Caddy

Nếu đã có Homebrew:

```bash
brew install caddy
```

Kiểm tra:

```bash
caddy version
```

Không cần:

```bash
brew services start caddy
```

cho mô hình local development này.

---

## 6.2. Set subdomain

```bash
export FOGEWISE_SUBDOMAIN=tasks-dash
FOGEWISE_DOMAIN="${FOGEWISE_SUBDOMAIN}.fogewise.io.vn"
```

Kiểm tra:

```bash
echo "$FOGEWISE_DOMAIN"
```

---

## 6.3. Override hosts

```bash
grep -F "$FOGEWISE_DOMAIN" /etc/hosts || true
```

Nếu chưa có:

```bash
echo "127.0.0.1 $FOGEWISE_DOMAIN" | sudo tee -a /etc/hosts
```

Flush DNS cache:

```bash
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder 2>/dev/null || true
```

---

## 6.4. Ping

```bash
ping -c 3 "$FOGEWISE_DOMAIN"
```

Phải resolve về:

```text
127.0.0.1
```

---

## 6.5. Chạy Caddy

Do port 443 cần quyền phù hợp, cách đơn giản cho onboarding:

```bash
sudo env \
  FOGEWISE_SUBDOMAIN="$FOGEWISE_SUBDOMAIN" \
  caddy run --config Caddyfile.dev
```

Ở terminal khác:

```bash
sudo caddy trust
```

Test:

```bash
curl -I "https://$FOGEWISE_DOMAIN"
```

---

# 7. Windows 10 / Windows 11

Mở **PowerShell as Administrator** cho phần setup.

## 7.1. Cài Caddy

### Chocolatey

```powershell
choco install caddy -y
```

hoặc Scoop:

```powershell
scoop install caddy
```

Kiểm tra:

```powershell
caddy version
```

---

## 7.2. Set subdomain

```powershell
$env:FOGEWISE_SUBDOMAIN = "tasks-dash"
```

Tạo domain:

```powershell
$FOGEWISE_DOMAIN = "$($env:FOGEWISE_SUBDOMAIN).fogewise.io.vn"
```

Kiểm tra:

```powershell
$FOGEWISE_DOMAIN
```

Kỳ vọng:

```text
tasks-dash.fogewise.io.vn
```

---

## 7.3. Override Windows hosts

Hosts file:

```text
C:\Windows\System32\drivers\etc\hosts
```

PowerShell Administrator:

```powershell
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"

if (-not (Select-String -Path $hostsPath -SimpleMatch $FOGEWISE_DOMAIN -Quiet)) {
    Add-Content `
        -Path $hostsPath `
        -Value "`r`n127.0.0.1 $FOGEWISE_DOMAIN"
}
```

Flush DNS:

```powershell
ipconfig /flushdns
```

---

## 7.4. Ping

```powershell
ping $FOGEWISE_DOMAIN
```

Phải thấy:

```text
Pinging tasks-dash.fogewise.io.vn [127.0.0.1]
```

Nếu ra IP public/VPS thì local hosts chưa đúng.

---

## 7.5. Chạy Caddy

Tại root repository:

```powershell
caddy run --config .\Caddyfile.dev
```

Environment variable:

```text
FOGEWISE_SUBDOMAIN
```

được lấy từ PowerShell hiện tại.

Ở PowerShell Administrator khác:

```powershell
caddy trust
```

Test:

```powershell
curl.exe -I "https://$FOGEWISE_DOMAIN"
```

---

# 8. Chạy application dev server

Sau khi setup domain/Caddy, chạy project như bình thường.

Ví dụ:

```bash
npm install
npm run dev
```

Caddy giả định:

```text
Web : 127.0.0.1:3000
API : 127.0.0.1:4000
```

Test trực tiếp:

```bash
curl -I http://127.0.0.1:3000
```

API:

```bash
curl -I http://127.0.0.1:4000
```

API có thể trả `401`, `404` hoặc status khác ở `/`; điều quan trọng là process đang listen đúng port.

---

# 9. Hot Reload / HMR

Caddy không build source.

Caddy chỉ proxy request:

```text
Browser
    |
    v
https://{sub_domain}.fogewise.io.vn
    |
    v
Caddy local
    |
    +--> Web dev server
    |
    `--> API dev server
```

Khi developer sửa code:

```text
edit source
    |
    v
save
    |
    v
Next.js / Vite HMR
hoặc Nest watch restart
    |
    v
browser cập nhật
```

Không cần:

```text
docker build
docker compose build
npm run build
push GHCR
deploy VPS
```

---

# 10. Local domain và Production domain là cùng hostname

Đây là điểm khác với guide cũ.

Không dùng:

```text
dev.fogewise.io.vn
```

làm một hostname chung cho mọi project.

Thay vào đó:

```text
{sub_domain}.fogewise.io.vn
```

được dùng ở cả local và production.

Ví dụ:

```text
tasks-dash.fogewise.io.vn
```

### Trên máy dev

```text
/etc/hosts
127.0.0.1 tasks-dash.fogewise.io.vn
```

nên:

```text
tasks-dash.fogewise.io.vn -> local
```

### Trên máy không setup dev override

Không có entry trong hosts:

```text
tasks-dash.fogewise.io.vn -> Cloudflare/DNS -> VPS
```

Do đó **không xóa public DNS production record**.

Local development chỉ override DNS trên đúng máy developer.

---

# 11. Nhiều developer

Dev A:

```text
127.0.0.1 tasks-dash.fogewise.io.vn
```

Dev B:

```text
127.0.0.1 tasks-dash.fogewise.io.vn
```

Dev C:

```text
127.0.0.1 tasks-dash.fogewise.io.vn
```

Cùng URL:

```text
https://tasks-dash.fogewise.io.vn
```

nhưng:

```text
Dev A thấy source của Dev A
Dev B thấy source của Dev B
Dev C thấy source của Dev C
```

vì `127.0.0.1` luôn là chính thiết bị hiện tại.

---

# 12. Nhiều project trên cùng máy

File `hosts` không hỗ trợ wildcard kiểu:

```text
127.0.0.1 *.fogewise.io.vn
```

Do đó mỗi project cần một entry cụ thể.

Ví dụ:

```text
127.0.0.1 tasks-dash.fogewise.io.vn
127.0.0.1 crm.fogewise.io.vn
127.0.0.1 farmer-app.fogewise.io.vn
```

Khi làm project nào, set:

```bash
export FOGEWISE_SUBDOMAIN=tasks-dash
```

hoặc:

```bash
export FOGEWISE_SUBDOMAIN=crm
```

rồi chạy Caddy trong repository tương ứng.

> Nếu nhiều project cần chạy đồng thời trên cùng máy và cùng port 443, cần một Caddy local chung để route nhiều host. Không chạy nhiều Caddy process cùng bind `127.0.0.1:443`.

---

# 13. Safety check trước khi dev

Trước khi chạy project, luôn kiểm tra domain local.

## Linux / macOS

```bash
FOGEWISE_DOMAIN="${FOGEWISE_SUBDOMAIN}.fogewise.io.vn"

IP="$(ping -c 1 "$FOGEWISE_DOMAIN" 2>/dev/null | head -1)"

echo "$IP"
```

Dòng đầu phải chứa:

```text
127.0.0.1
```

Check nhanh:

```bash
ping -c 1 "$FOGEWISE_DOMAIN" | grep '127.0.0.1'
```

## Windows

```powershell
ping $FOGEWISE_DOMAIN
```

Phải có:

```text
[127.0.0.1]
```

Nếu không resolve về `127.0.0.1`, developer có thể đang truy cập production thay vì local.

---

# 14. Kiểm tra toàn bộ setup

## Fedora / macOS

```bash
echo '=== DOMAIN ==='
echo "$FOGEWISE_DOMAIN"

echo
echo '=== DNS / HOSTS ==='
ping -c 1 "$FOGEWISE_DOMAIN"

echo
echo '=== WEB DIRECT ==='
curl -I http://127.0.0.1:3000

echo
echo '=== API DIRECT ==='
curl -I http://127.0.0.1:4000 || true

echo
echo '=== LOCAL HTTPS ==='
curl -I "https://$FOGEWISE_DOMAIN"
```

## Windows

```powershell
Write-Host "=== DOMAIN ==="
Write-Host $FOGEWISE_DOMAIN

Write-Host "`n=== DNS / HOSTS ==="
ping $FOGEWISE_DOMAIN

Write-Host "`n=== WEB DIRECT ==="
curl.exe -I http://127.0.0.1:3000

Write-Host "`n=== API DIRECT ==="
curl.exe -I http://127.0.0.1:4000

Write-Host "`n=== LOCAL HTTPS ==="
curl.exe -I "https://$FOGEWISE_DOMAIN"
```

---

# 15. Kết quả đúng

Ví dụ:

```text
FOGEWISE_SUBDOMAIN=tasks-dash
```

Domain:

```text
tasks-dash.fogewise.io.vn
```

Ping trên máy dev:

```text
127.0.0.1
```

Browser:

```text
https://tasks-dash.fogewise.io.vn
```

Frontend:

```text
HTTP 200
```

API:

```text
https://tasks-dash.fogewise.io.vn/api/*
```

Caddy proxy giữ nguyên prefix:

```text
http://127.0.0.1:4000/api/*
```

Source thay đổi:

```text
save -> HMR/watch -> browser cập nhật
```

---

# 16. Firefox và Local CA

Nếu Firefox báo:

```text
SEC_ERROR_UNKNOWN_ISSUER
```

thử:

```bash
caddy trust
```

Nếu vẫn lỗi:

1. Mở:

```text
about:config
```

2. Tìm:

```text
security.enterprise_roots.enabled
```

3. Đặt:

```text
true
```

4. Restart Firefox.

---

# 17. Troubleshooting

## Domain ra IP production thay vì 127.0.0.1

### Fedora / macOS

```bash
grep -F "$FOGEWISE_DOMAIN" /etc/hosts
```

Phải có:

```text
127.0.0.1 {sub_domain}.fogewise.io.vn
```

### Windows

```powershell
Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" |
    Select-String $FOGEWISE_DOMAIN
```

Phải có:

```text
127.0.0.1 {sub_domain}.fogewise.io.vn
```

---

## Caddy trả 502

Test upstream:

```bash
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:4000
```

Nếu connection refused thì Caddy đang chạy nhưng dev server chưa chạy hoặc sai port.

---

## Port 443 đang bị chiếm

Fedora:

```bash
sudo ss -ltnp | grep ':443'
```

macOS:

```bash
sudo lsof -nP -iTCP:443 -sTCP:LISTEN
```

Windows:

```powershell
netstat -ano | findstr :443
```

---

## Fedora không bind được port 443

```bash
sudo setcap cap_net_bind_service=+ep "$(command -v caddy)"
```

---

## Certificate chưa được trust

```bash
caddy trust
```

Hoặc nếu hệ điều hành yêu cầu:

```bash
sudo caddy trust
```

---

# 18. Stop / Reload Caddy

Nếu chạy foreground:

```text
Ctrl + C
```

Nếu chạy bằng `caddy start`:

```bash
caddy stop
```

Reload config:

### Linux / macOS

```bash
caddy reload --config Caddyfile.dev
```

### Windows

```powershell
caddy reload --config .\Caddyfile.dev
```

Source application thay đổi **không cần reload Caddy**.

---

# 19. Security

Local Caddy dùng:

```caddy
bind 127.0.0.1
```

nên chỉ nhận kết nối từ chính thiết bị developer.

Local HTTPS dùng:

```caddy
tls internal
```

nên certificate được cấp bởi Caddy Local CA.

Không:

- expose port 3000/4000 ra Internet;
- mở router port;
- dùng ngrok;
- dùng Cloudflare Tunnel;
- deploy source lên VPS;
- copy Local CA private key giữa các developer;
- commit certificate/private key vào Git.

Public production DNS vẫn giữ nguyên.

---

# 20. Daily workflow

Sau setup lần đầu, Fedora/macOS:

```bash
export FOGEWISE_SUBDOMAIN=tasks-dash
FOGEWISE_DOMAIN="${FOGEWISE_SUBDOMAIN}.fogewise.io.vn"

ping -c 1 "$FOGEWISE_DOMAIN"

npm run dev
```

Terminal khác:

```bash
export FOGEWISE_SUBDOMAIN=tasks-dash
caddy run --config Caddyfile.dev
```

Mở:

```text
https://tasks-dash.fogewise.io.vn
```

Windows:

```powershell
$env:FOGEWISE_SUBDOMAIN = "tasks-dash"
$FOGEWISE_DOMAIN = "$($env:FOGEWISE_SUBDOMAIN).fogewise.io.vn"

ping $FOGEWISE_DOMAIN

npm run dev
```

Terminal Administrator khác:

```powershell
$env:FOGEWISE_SUBDOMAIN = "tasks-dash"

caddy run --config .\Caddyfile.dev
```

---

# 21. Repository contract

Nên commit:

```text
Caddyfile.dev

docs/
  FOGEWISE_LOCAL_DEV_GUIDE.md
```

Không commit:

```text
.env
certificate
private key
Caddy Local CA
```

`Caddyfile.dev` không hard-code project name:

```caddy
{$FOGEWISE_SUBDOMAIN}.fogewise.io.vn {
    bind 127.0.0.1
    tls internal

    @api path /api /api/*
    handle @api {
        reverse_proxy 127.0.0.1:4000
    }

    handle {
        reverse_proxy 127.0.0.1:3000
    }
}
```

Do đó cùng template có thể reuse cho mọi Fogewise project.

---

# 22. Quick reference

| OS | Set subdomain | Hosts file | Ping |
|---|---|---|---|
| Fedora | `export FOGEWISE_SUBDOMAIN=tasks-dash` | `/etc/hosts` | `ping -c 1 "$FOGEWISE_DOMAIN"` |
| macOS | `export FOGEWISE_SUBDOMAIN=tasks-dash` | `/etc/hosts` | `ping -c 1 "$FOGEWISE_DOMAIN"` |
| Windows | `$env:FOGEWISE_SUBDOMAIN = "tasks-dash"` | `C:\Windows\System32\drivers\etc\hosts` | `ping $FOGEWISE_DOMAIN` |

Local hosts:

```text
127.0.0.1 {sub_domain}.fogewise.io.vn
```

Local Caddy:

```text
https://{sub_domain}.fogewise.io.vn
    /api/* -> 127.0.0.1:4000
    /*     -> 127.0.0.1:3000
```

Production:

```text
https://{sub_domain}.fogewise.io.vn
    -> Cloudflare
    -> VPS
    -> Docker/GHCR
```

Khác biệt nằm ở **DNS resolution của chính thiết bị developer**, không nằm ở URL.

---

## Tài liệu Caddy

- https://caddyserver.com/docs/install
- https://caddyserver.com/docs/caddyfile/concepts
- https://caddyserver.com/docs/caddyfile/directives/tls
- https://caddyserver.com/docs/running
- https://caddyserver.com/docs/command-line


---

# Cập nhật lifecycle Local Dev (v6)

Local hosts override chỉ tồn tại khi Local Dev launcher đang chạy.

```text
START
  -> remove stale "# fogewise-local-dev"
  -> add {sub_domain}.fogewise.io.vn -> 127.0.0.1
  -> start local Caddy

STOP / Ctrl+C / normal exit
  -> stop local Caddy
  -> remove "# fogewise-local-dev"
  -> flush DNS
  -> domain quay lại public DNS / production
```

Nếu process bị kill cứng hoặc máy crash, chạy `Fogewise Local Reset` để xóa stale entry.

Production Preview không sửa production hostname trong hosts và dùng hostname riêng:

```text
https://{sub_domain}-{dev_slug}.fogewise.io.vn
```


---

# Production Preview v7 — Tunnel Token

Production Preview dùng tunnel do Fogewise/Cloudflare admin provision trước.

```text
Admin
  -> tạo tunnel riêng cho project + developer
  -> map hostname {sub_domain}-{dev_slug}.fogewise.io.vn
  -> origin http://127.0.0.1:18080
  -> cấp tunnel token

Developer
  -> lưu token trong .fogewise-production.local
  -> tự chạy project
  -> chạy Production Preview launcher
  -> cloudflared tunnel --protocol http2 --edge-ip-version 4 run --token ...
```

Developer không cần quyền quản trị zone `fogewise.io.vn`.

Production Preview không sửa production hostname trong hosts.


---

## v8 folder layout

Scripts are grouped under `fedora/`, `macos/`, and `windows/`. Shared Caddy files are under `common/`. Local config files remain at the `fogewise-dev-launchers/` root.

---

# LCSP local Docker infra on Fedora

LCSP host development currently uses these local connection strings:

```env
RABBITMQ_URL=amqp://fogewise:10e0064b19b1dc9727458cdbb0e4f3998d8988628619d807@127.0.0.1:5672
```

The RabbitMQ URL already uses `127.0.0.1`, but the Redis URL uses hostname `fogewise-redis` from the host OS. For that reason the Fedora local infra launcher does two things:

1. starts Docker containers `fogewise-rabbitmq` and `fogewise-redis`;
2. adds a host-only alias:

```text
127.0.0.1 fogewise-redis # fogewise-local-infra
```

## Start local infra

```bash
./fogewise-dev-launchers/fedora/fogewise-local-infra-fedora.sh
```

This script:

- ensures Docker is installed/running;
- starts RabbitMQ on `127.0.0.1:5672`;
- starts RabbitMQ management UI on `127.0.0.1:15672`;
- starts Redis on `127.0.0.1:6379`;
- creates the `fogewise-redis` hosts alias on Fedora.

## Stop/reset local infra

```bash
./fogewise-dev-launchers/fedora/fogewise-local-infra-reset-fedora.sh
```

This stops the containers and removes the `fogewise-redis` hosts alias.

## Quick verification

RabbitMQ:

```bash
docker ps --filter name=fogewise-rabbitmq
curl -I http://127.0.0.1:15672
```

Redis:

```bash
docker ps --filter name=fogewise-redis
getent hosts fogewise-redis
```

Expected host-side env values:

```env
RABBITMQ_URL=amqp://fogewise:10e0064b19b1dc9727458cdbb0e4f3998d8988628619d807@127.0.0.1:5672
```
