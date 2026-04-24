# Caddy + DNS cutover

End-to-end steps to move `tx.silknodes.io` from GitHub Pages onto the
VM with HTTPS via Caddy. Order matters — DNS has to flip BEFORE Caddy
reloads, so the TLS certificate challenge can succeed.

## Prerequisites

- `silknodes-web.service` is up and `curl http://localhost:3002`
  returns the Next.js site
- Caddy is installed and running (installed earlier in the Phase 2
  work; verify with `systemctl status caddy`)
- You own the DNS record for `tx.silknodes.io` and can change it

## Step 1 — install the Caddyfile

```bash
# From the VM, inside the repo
sudo cp /home/zoltan/tx-silknodes/vm-service/Caddyfile.example \
  /etc/caddy/Caddyfile

# Format + validate before reloading
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
```

If `caddy validate` reports any errors, fix them before moving on.

## Step 2 — flip DNS

In your DNS provider (Cloudflare, Route 53, Namecheap, whatever):

- Delete or comment out the existing CNAME / A record pointing
  `tx.silknodes.io` at GitHub Pages
- Add a new A record: `tx.silknodes.io` → `<VM public IP>`
- TTL: 300 seconds so the switch propagates quickly
- If your DNS provider has proxying/CDN (Cloudflare orange cloud),
  **disable it for this record** during cutover so Caddy can solve
  the ACME HTTP-01 challenge directly. You can re-enable after the
  cert is issued.

Wait for propagation. Verify from outside:

```bash
dig +short tx.silknodes.io
# Should show the VM IP, not the GitHub Pages IPs (185.199.108-111.*)
```

## Step 3 — reload Caddy

```bash
sudo systemctl reload caddy

# Watch Caddy fetch the certificate (takes ~10-30 s)
sudo journalctl -u caddy -f
```

Look for log lines like:

```
certificate obtained successfully
```

If you see `could not get certificate` — DNS hasn't propagated yet,
or Cloudflare proxying is still on. Wait, fix, retry.

## Step 4 — smoke test

```bash
# HTTPS with a real cert
curl -sI https://tx.silknodes.io/api/health
# Should return HTTP/2 200 + JSON headers

# Full response
curl -s https://tx.silknodes.io/api/health
```

Open `https://tx.silknodes.io` in a browser — the green padlock
confirms TLS. Click through Analytics / Whale Tracker tabs and
verify everything loads as it did on `http://<vm-ip>:3002`.

## Step 5 — clean up

- Keep the disabled GitHub Pages workflow for one week as rollback
  (restoring `next.config.ts` + manually triggering the workflow
  would bring Pages back up).
- Once you're satisfied, you can `gh workflow disable deploy.yml`
  permanently or delete the file.

## Rollback

If the VM goes sideways and you need to revert to GitHub Pages:

1. Point DNS back at GitHub Pages (`185.199.108-111.153` / CNAME)
2. `git revert` the Phase 2 commits, OR restore the `output: "export"`
   block in `next.config.ts` manually
3. Re-enable + manually trigger `deploy.yml`
4. Pages site serves the last-deployed state

## What can go wrong

| Symptom | Fix |
| --- | --- |
| `certificate obtained successfully` never appears | DNS hasn't propagated, or Cloudflare proxying is still on |
| Browser shows "NET::ERR_CERT_AUTHORITY_INVALID" | Caddy is serving its default self-signed cert; reload and check `journalctl -u caddy` |
| `502 Bad Gateway` | `silknodes-web` isn't running on 3002 — `systemctl status silknodes-web` |
| Everything loads but whale tracker is empty | Sequelize can't reach Postgres — check `PGUSER/PGPASSWORD/PGDATABASE` in `/home/%i/.silknodes-db.env`; restart `silknodes-web` |
| Site loads but feels slow | Disable gzip temporarily to rule out a compression CPU loop |
