---
title: Production Hosting — Dokploy, Cloudflare Zero Trust, Encrypted Backups
description: Reproducible end-to-end guide to run OpenKeep on a single VPS behind Dokploy and Cloudflare Access, with client-side-encrypted offsite backups.
---

# Production Hosting — Dokploy + Cloudflare Zero Trust + Encrypted Backups

This guide describes a complete, security-hardened way to self-host OpenKeep on a
single small VPS. It is written to be **reproducible**: replace every `<PLACEHOLDER>`
with your own value. No real hostnames, IPs, e-mails, or secrets appear here.

It complements the basic [Deployment Guide](./deployment-guide.md) (plain Docker Compose)
with a production setup used in practice:

- **Dokploy** as the deployment platform (Git-driven, auto-deploy)
- **images built in CI** (GitHub Actions → GHCR) so the small VPS never builds
- **Cloudflare Tunnel + Access (Zero Trust)** so nothing is exposed to the public internet
- a **service token** so the native mobile app works behind Access
- **client-side-encrypted, offsite backups** with `restic` (Postgres + MinIO), scheduled and monitored

> Runs comfortably on a 2 vCPU / 2 GB RAM / ~40 GB VPS **if** builds are offloaded to CI
> and OpenKeep is configured for a cloud AI/OCR provider (e.g. Mistral) instead of local OCR.

## Placeholders used

| Placeholder | Meaning |
|---|---|
| `<YOUR_DOMAIN>` | your apex domain, e.g. the one serving OpenKeep |
| `deploy.<YOUR_DOMAIN>` | subdomain for the Dokploy panel |
| `<SERVER_IP>` | the VPS public IPv4 |
| `<PUBLIC_NIC>` | the VPS public network interface (find with `ip -o link show`, often `eth0`/`ens…`) |
| `<ADMIN_USER>` | your non-root sudo user on the VPS |
| `<GHCR_OWNER>` | your GitHub username/org (lowercase) hosting the container images |
| `you@example.com` | your login e-mail |

---

## 1. Architecture

```
Internet ──▶ Cloudflare edge (DNS, TLS, Zero Trust Access)
                     │  outbound-only Cloudflare Tunnel
                     ▼
VPS: cloudflared ──▶ Traefik (Dokploy) ──▶ OpenKeep stack
                                            postgres(pgvector) · minio · api · worker
     public ports 80/443 blocked · only the tunnel serves traffic · SSH for admin
                     │ nightly, client-side-encrypted (restic)
                     ▼
              Offsite object storage (S3-compatible or OneDrive via rclone)
```

Key properties:

- The origin has **no public web port**. All traffic arrives through Cloudflare's tunnel.
- **Cloudflare Access** sits in front of both the app and the panel (browser login; service token for the app).
- Backups are **encrypted before upload**, so the storage provider never sees plaintext.

---

## 2. Prerequisites

- A VPS (Ubuntu 24.04 LTS recommended).
- A domain whose DNS is managed by **Cloudflare** (free plan is fine).
- A GitHub repository (fork) of OpenKeep for CI image builds.
- An AI/OCR provider key (this guide assumes **Mistral**; see [Configuration Reference](./configuration-reference.md)).
- An offsite storage target for backups (any S3-compatible bucket, or OneDrive/other via `rclone`).

---

## 3. Server hardening (once)

Create a sudo user, disable root/password SSH, enable a firewall, add swap, and log rotation:

```bash
adduser <ADMIN_USER> && usermod -aG sudo <ADMIN_USER>
# copy your SSH key:  ssh-copy-id <ADMIN_USER>@<SERVER_IP>

sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

apt-get update && apt-get install -y unattended-upgrades fail2ban ufw
systemctl enable --now fail2ban
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# swap (important on 2 GB RAM)
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' >> /etc/sysctl.conf && sysctl -p

# docker log rotation
mkdir -p /etc/docker
printf '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }\n' > /etc/docker/daemon.json
```

> Note: `ufw` does **not** govern Docker-published ports — Docker writes iptables directly.
> Public port lockdown is handled in section 9 via the `DOCKER-USER` chain.

---

## 4. Install Dokploy

```bash
curl -sSL https://dokploy.com/install.sh | sh
```

Then immediately open `http://<SERVER_IP>:3000` and **create the admin account** (whoever
opens it first becomes admin). In the panel:

1. Enable **2FA** on your profile.
2. Settings → Server: set the panel domain `deploy.<YOUR_DOMAIN>` and a Let's Encrypt e-mail;
   choose **Let's Encrypt** as certificate provider.

Dokploy is invitation-only after the first admin — there is no open self-registration.

---

## 5. Build images in CI (GitHub Actions → GHCR)

The OpenKeep worker installs a large OCR toolchain; building it on a 2 GB VPS is the main
resource killer. Offload builds to CI and let the VPS pull finished images.

Add a workflow that builds `worker-base`, `api`, `migrate`, and `worker` and pushes to GHCR
on every push to `main` (see `.github/workflows/build-images.yml` in the repo). It uses
`${{ github.repository_owner }}` so it works for any fork.

After the first run, make the four packages public, **or** add a GHCR registry
(username + a PAT with `read:packages`) under Dokploy → Settings → Registry so the VPS can pull.

---

## 6. Deploy OpenKeep in Dokploy

Use a production compose file (`docker-compose.prod.yml`) that differs from the dev compose:

- images come from GHCR (`ghcr.io/<GHCR_OWNER>/openkeep-*`) instead of `build:`
- **no published ports** (Traefik routes internally); Postgres/MinIO/API are never exposed
- docs/typesense services removed (only needed for the docs site)
- cloud AI/OCR only, e.g. `ACTIVE_PARSE_PROVIDER=mistral-ocr` and an **empty** `FALLBACK_PARSE_PROVIDER`
  (so a provider outage never silently starts local OCR on the small box)
- every secret provided via Dokploy's **Environment** tab; use `${VAR:?}` so a missing secret
  fails the deploy instead of starting with a default

In Dokploy: create a project → **Compose** service → connect the Git repo, branch `main`,
compose path `docker-compose.prod.yml`, enable Auto-Deploy. Fill the Environment tab from
`.env.production.example`, generate strong values (`openssl rand -base64 32`), and **replace all
default credentials** shipped in the dev compose (Postgres/MinIO/JWT/owner password).

Deploy, then add the domain `<YOUR_DOMAIN>` → service `api`, container port `3000`.
(At this stage you may use Let's Encrypt; section 8 switches routing to the Cloudflare tunnel.)

Verify: `https://<YOUR_DOMAIN>/api/health` returns `{"status":"ok", …}` with your provider config.

---

## 7. Move DNS to Cloudflare

Add the domain as a zone in Cloudflare and change the nameservers at your registrar to the
two Cloudflare nameservers.

> **DNSSEC gotcha:** if the domain had DNSSEC enabled at the old provider, **disable DNSSEC /
> remove the old DS record at the registrar** as part of the move. A stale DS record makes the
> whole domain fail (`SERVFAIL`) for DNSSEC-validating resolvers. Verify with
> `dig DS <YOUR_DOMAIN> @<a-tld-nameserver> +short` (should be empty) and
> `dig <YOUR_DOMAIN> @8.8.8.8` (status `NOERROR`).

---

## 8. Cloudflare Tunnel + Access (Zero Trust)

### 8.1 Create the tunnel

Cloudflare dashboard → Zero Trust → Networks → **Tunnels** → create a `cloudflared` tunnel.
On the VPS, run the generated install command (Debian/Ubuntu) — it installs `cloudflared` as a
systemd service that connects outbound to Cloudflare.

### 8.2 Route the hostnames through Traefik

Add two public hostnames on the tunnel, both pointing at the local Traefik over HTTPS:

| Hostname | Service |
|---|---|
| `<YOUR_DOMAIN>` | `HTTPS` → `localhost:443`, **No TLS Verify = on** |
| `deploy.<YOUR_DOMAIN>` | `HTTPS` → `localhost:443`, **No TLS Verify = on** |

Traefik routes by Host header, so both share one origin. "No TLS Verify" is safe here — the hop
is loopback on the box. Set the zone's SSL/TLS mode to **Full**. Creating these routes replaces
the A records with tunnel `CNAME`s automatically (delete the old A records if prompted).

### 8.3 Protect the panel and the app with Access

Zero Trust → Access → Applications → **Self-hosted / Public hostname**:

- **App 1 — panel**: destination `deploy.<YOUR_DOMAIN>`, one policy **Allow** with
  `Include → Emails → you@example.com`. Browser-only → the e-mail login (one-time PIN) is ideal.
- **App 2 — OpenKeep**: destination `<YOUR_DOMAIN>`, two policies:
  1. **Service Auth** → `Include → Service Token → <token>` (for the native mobile app)
  2. **Allow** → `Include → Emails → you@example.com` (for the web app in a browser)

Create the service token under Access → **Service credentials** (Client ID + Secret; store both
in a password manager — the secret is shown once).

> Access enforcement on a **freshly created** Zero Trust org can take several minutes to
> propagate to the edge. Verify from a cookieless client:
> `curl -sI https://<YOUR_DOMAIN>/api/health` → `302` to `…cloudflareaccess.com` means Access is active.

### 8.4 Native mobile app behind Access

Cloudflare Access is a browser login wall; a native app cannot complete the redirect. OpenKeep's
mobile app therefore sends the service-token headers `CF-Access-Client-Id` and
`CF-Access-Client-Secret` on every request (entered on the connect screen alongside the API token).
The web app needs no token — after the browser login it carries the `CF_Authorization` cookie
automatically.

---

## 9. Lock the origin (force all traffic through the tunnel)

The tunnel is outbound-only, so no inbound web port is needed. Blocking public 80/443 closes the
"hit the origin IP directly with a spoofed Host header" bypass. Because Docker bypasses `ufw`,
block on the `DOCKER-USER` chain against the public interface (loopback — used by the tunnel — is
unaffected):

```bash
sudo iptables  -I DOCKER-USER -i <PUBLIC_NIC> -p tcp -m multiport --dports 80,443 -j DROP
sudo ip6tables -I DOCKER-USER -i <PUBLIC_NIC> -p tcp -m multiport --dports 80,443 -j DROP
```

Make it reboot-safe (Docker recreates `DOCKER-USER` empty on boot) with a small systemd unit that
re-applies the rules after `docker.service`. Keep SSH (22) open, and consider a VPN (e.g.
Tailscale) plus your provider's out-of-band console as lockout safety nets before you rely on this.

Verify: `https://<YOUR_DOMAIN>` still works (via Cloudflare), but a direct request to
`https://<SERVER_IP>` no longer connects.

---

## 10. Encrypted offsite backups (restic)

Dokploy's built-in backups are convenient but **not client-side encrypted**. For sensitive
documents, use `restic`, which encrypts before upload, deduplicates, does incremental snapshots,
GFS retention, and integrity checks. restic speaks S3 natively and any other backend via `rclone`
(e.g. OneDrive).

**What to back up (both, close in time):**

- **Postgres** — a logical `pg_dump` streamed into restic (metadata, users, tags, embeddings).
- **MinIO volume** — the actual document objects.

**Sketch of the nightly job** (systemd timer → script; full versions belong in your ops repo):

```bash
# repo + password come from a root-only env file; S3 keys OR rclone config depending on target
docker exec "$PG" pg_dump -U openkeep -d openkeep --clean --if-exists \
  | restic backup --stdin --stdin-filename openkeep-postgres.sql --tag openkeep-db
restic backup "$MINIO_VOLUME_MOUNTPOINT" --tag openkeep-minio
restic forget --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune
restic check --read-data-subset=1/20
```

Operational notes:

- Store the **restic password in a password manager** — without it every backup is unrecoverable.
  It is separate from the storage credentials.
- Prefer a **different provider** than where the VPS runs (true offsite independence).
- restic stores a single content-addressed repository (`data/ index/ snapshots/ keys/ config`),
  **not** one folder per run. Inspect history with `restic snapshots`, never via the storage
  provider's file browser (and never edit those files by hand).
- Set `RESTIC_CACHE_DIR` (e.g. `/var/cache/restic`) for the root-run service, otherwise restic
  rebuilds its cache every run.
- Add a **dead-man's-switch monitor** (e.g. healthchecks.io): ping on success, and it alerts if a
  run is missing entirely — which a "mail on failure" approach cannot catch.
- If using OneDrive via rclone: the OAuth token can expire and make backups fail silently — the
  monitor is what surfaces it; re-authorize with `rclone` and copy the config back.

**Restore (non-destructive test quarterly):**

```bash
restic dump --tag openkeep-db latest openkeep-postgres.sql | head   # decrypts to valid SQL
restic restore --tag openkeep-minio latest --target /tmp/restore-test
```

To actually restore: pipe the DB dump into `psql` in the Postgres container, and rsync the
restored MinIO tree back into the volume (stop the stack first). See
[Backup, Restore, and Portability](./backup-restore-and-portability.md).

---

## 11. Maintenance & troubleshooting

- **Updates:** app via `git push` → CI → Dokploy auto-deploy; Dokploy via its update script; OS via
  unattended-upgrades. Roll back by pinning a previous image tag.
- **Disk:** enable Dokploy's daily Docker cleanup so old images don't fill the disk.
- **Memory:** on 2 GB, watch `free -h` / `docker stats`; if it swaps under normal load, size up.
- **Locked out of SSH:** use the provider's console (or the VPN) and adjust the firewall.
- **Site down:** check `systemctl status cloudflared`, container health in Dokploy, and the
  Cloudflare/Access status.

---

## Security checklist

- [ ] SSH key-only, no root login, fail2ban active
- [ ] Only 22 reachable publicly; 80/443 blocked at origin (tunnel-only), reboot-safe
- [ ] Postgres/MinIO/API have no published ports
- [ ] All default credentials from the dev compose replaced; secrets only in the Environment tab
- [ ] Dokploy admin has 2FA; registration is invitation-only
- [ ] Cloudflare Access in front of both the app and the panel
- [ ] Backups encrypted client-side, offsite, scheduled, monitored, and **restore-tested**
