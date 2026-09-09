# Production Deployment (VPS, Docker Compose)

Production runs on a single VPS via `docker-compose.prod.yml`, backed by
**Neon** (managed serverless Postgres) rather than a local database
container:

| Service     | Image / build                     | Role                                                        |
| ----------- | --------------------------------- | -------------------------------------------------------------- |
| `frontend`  | `frontend/Dockerfile` @production | React Router SSR server on :8080                            |
| `migrate`   | `backend/Dockerfile` @production  | One-shot: `alembic upgrade head` against Neon, then exits   |
| `backend`   | `backend/Dockerfile` @production  | FastAPI on :8000; waits for `migrate` to exit 0 before start |
| `webhook`   | `deploy/webhook/Dockerfile`       | GitHub push receiver that triggers a redeploy (§5)          |
| `scheduler` | `alpine:3.21` + crond             | Daily snapshot/dividend job (replaces Cloud Scheduler)      |

There is no `db` or `db-backup` service: the backend connects directly to
Neon over `DATABASE_URL` (see `.env.production.example`), and Neon's own
point-in-time recovery covers backups — there's no nightly `pg_dump` cron to
maintain on the VPS. There's no `caddy` service either: TLS termination and
routing are handled by a **shared Caddy instance living outside this repo**,
at `~/edge-proxy` on the VPS — this app joins it over an `edge` Docker
network declared `external: true` in `docker-compose.prod.yml`, alongside
whatever other projects share the same VPS/proxy. This compose file
publishes no host ports at all; `frontend`, `backend` and `webhook` are only
reachable via that external network.

## 1. One-time VPS setup

The shared `~/edge-proxy` Caddy stack (its own compose project, outside
this repo) must already be up and must already have created the `edge`
external Docker network before this app's `up -d` will succeed — compose
fails fast if a network marked `external: true` doesn't exist yet.

```bash
# Docker Engine + compose plugin (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# Firewall: only SSH + HTTP(S)
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

git clone <repo-url> finance-tracker && cd finance-tracker
cp .env.production.example .env.production
# Fill in every value — generate secrets with `openssl rand -hex 32`.
# DATABASE_URL comes from the Neon project's connection string (pooled,
# sslmode=require); create the Neon project/branch before this step.
nano .env.production
```

DNS: point `A`/`AAAA` records for **both** domains (`FRONTEND_DOMAIN` and
`API_DOMAIN`) at the VPS IP *before* first boot, so Let's Encrypt issuance
succeeds. Keep the same domains as the Cloud Run deployment and cookies/CORS
keep working unchanged. The routes themselves — which hostname forwards to
`frontend:8080` vs `backend:8000` vs `webhook:9000` — live in `~/edge-proxy`'s
own Caddyfile, not in this repo; see §5 for the `webhook` route.

## 2. First deploy

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f    # watch until healthy
```

`migrate` applies Alembic migrations against Neon and exits before `backend`
starts, so a fresh database gets the full schema without delaying the
backend's own port bind.

Smoke test:

```bash
curl -I https://$API_DOMAIN/docs         # 200
curl -I https://$FRONTEND_DOMAIN         # 200
```

## 3. Migrating data off the old (gcloud) database

Restore straight into Neon — there's no local `db` container to stage
through. Run from any machine that can reach both databases (old URL from
the `FINANCE_TRACKER_DB_URL` secret, new URL from the Neon project):

```bash
pg_dump "<old DATABASE_URL>" -Fc -f finance.dump
pg_restore "<Neon DATABASE_URL>" --clean --if-exists --no-owner finance.dump
```

Then start the app stack (stop it first if it's already running against the
new DB, so nothing writes mid-restore):

```bash
cd ~/finance-tracker
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Cutover order: create Neon project → restore data → deploy VPS → verify over
HTTPS → flip DNS → decommission gcloud (below).

## 4. Deploying updates

```bash
cd ~/finance-tracker && git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker image prune -f
```

`up -d --build` only recreates containers whose image or config changed.
`migrate` re-runs and `backend` waits for it before restarting, so migrations
still apply automatically — just without blocking `backend`'s own boot.
Rollback = `git checkout <last-good-sha>` and re-run the same command (plus a
backup restore if a migration must be undone).

## 5. Continuous deployment (GitHub webhook)

A `webhook` service (`deploy/webhook`) verifies GitHub's push signature and
— on a push to `main` — runs exactly the three commands from "Deploying
updates" above (`git pull`, `docker compose up -d --build`,
`docker image prune -f`). It talks to the *host's* Docker daemon over a
bind-mounted socket rather than running its own, so no separate CI runner or
registry is needed; the VPS builds its own images the same way it always
has, just automatically. Like `backend`/`frontend`, it isn't reachable
directly — it joins the shared `edge` network so `~/edge-proxy`'s Caddy can
reach it at `webhook:9000`, and needs a route added there.

**One-time VPS setup**, in `.env.production`:

```bash
REPO_DIR=/home/ubuntu/finance-tracker   # must be the repo's real absolute path on this host
SSH_DIR=/home/ubuntu/.ssh               # must already have working `git pull` access
WEBHOOK_SECRET=$(openssl rand -hex 32)
DEPLOY_BRANCH=refs/heads/main           # default; only change if you retarget the deploy branch
```

`REPO_DIR` has to be the literal host path (e.g. `/home/ubuntu/finance-tracker`,
not `~/finance-tracker` or a container-local alias): the webhook container
runs `docker compose` against the host daemon via the bind-mounted socket
(Docker-outside-of-Docker), and compose resolves this file's own relative
bind mounts (the `backend`/`frontend`/`webhook` build contexts, …) against
whatever path you pass it — those resolved paths go straight to the host
daemon, which only knows the real filesystem. Get this wrong and the
redeploy silently mounts the wrong thing (or nothing) into
`backend`/`frontend`.

`SSH_DIR` just needs to be wherever the VPS user's SSH key + `known_hosts`
already live — the same ones that make `git pull` work when you run it by
hand today. Consider replacing your personal key with a **repo-scoped, read-only
[deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)**
for this purpose instead, since it'll now sit mounted (read-only) inside a
container that's reachable from the internet.

Then bring the new service up:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

**One-time edge-proxy setup:** add a route in `~/edge-proxy`'s Caddyfile so
`$API_DOMAIN/hooks/*` forwards to this project's `webhook` container over
the shared network (adjust to match how that Caddyfile names/imports other
apps' blocks — this is the shape of what's needed, on the `$API_DOMAIN`
site block, ahead of its catch-all `reverse_proxy` to this app's `backend`):

```caddyfile
route /hooks/* {
	reverse_proxy webhook:9000
}
```

Verify the route resolves before wiring up GitHub:

```bash
curl https://$API_DOMAIN/hooks/healthz    # -> ok
```

**One-time GitHub setup:** repo → Settings → Webhooks → Add webhook:

- Payload URL: `https://$API_DOMAIN/hooks/deploy`
- Content type: `application/json`
- Secret: same value as `WEBHOOK_SECRET`
- Events: "Just the push event"

GitHub's first delivery is a `ping`, which the receiver answers `200 pong`
without deploying — check it under the webhook's "Recent Deliveries" tab.
From then on, every push to `main` triggers a redeploy; pushes to other
branches are received (200) and ignored.

Watch a deploy happen: `docker compose -f docker-compose.prod.yml logs -f webhook`.
It logs the `git pull` and `docker compose up --build` output as it runs; a
push that arrives mid-build is skipped rather than queued, so it just
piggybacks on the build already running from the push before it.

The manual command in "Deploying updates" above still works — for a branch
other than `main`, a rollback, or if the webhook itself needs debugging.

**Branch model**: `dev` stays GitHub's default branch and where PRs land —
there's no CI test gate on this repo, so `dev` is the checkpoint before code
goes live. `main` only ever moves by fast-forwarding it to `dev` when ready
to ship (`git checkout main && git merge --ff-only dev && git push origin
main`); that push is what fires the webhook.

**The automated deploy step deliberately excludes `webhook` from `--build`.**
BuildKit stamps a fresh timestamp into an image's config on every build, even
one that's a full cache hit, so an unscoped `docker compose up -d --build`
gives `webhook` a "new" image — and therefore a container recreate — on
*every* deploy, not just ones that touch `deploy/webhook/*`. Recreating the
container that's in the middle of running that very `docker compose` command
kills the deploy mid-run: images finish building, but `backend`/`frontend`
never get (re)started, leaving the stack down until someone notices. `run_deploy()`
in `deploy/webhook/server.py` therefore names the services it builds
explicitly (`migrate backend frontend scheduler`) rather than leaving the
list unscoped. A change to anything under `deploy/webhook/` still needs one
manual deploy from the **host shell** (not triggered through the webhook)
to pick it up: `cd $REPO_DIR && docker compose --env-file .env.production -f
docker-compose.prod.yml up -d --build`.

**Security note:** the `webhook` container has the Docker socket
bind-mounted in, which is effectively root on the host — that's what lets it
run `docker compose up --build` at all. The only thing standing between the
internet and that is `WEBHOOK_SECRET`'s HMAC check, so treat it like any
other production credential (`openssl rand -hex 32`, not committed, rotated
via GitHub's webhook settings + `.env.production` together if it ever leaks).

## 6. Scheduled jobs

The `scheduler` container fires `POST /internal/tasks/daily-snapshot` at
01:00 UTC daily with the `X-Scheduler-Secret` header. The job catches up from
each household's last snapshot date, so missed runs self-heal. The route is
only ever called from inside the compose network (`scheduler` → `backend`),
and `backend`'s own `verify_scheduler_secret` (`backend/src/routers/internal.py`)
rejects any request whose header doesn't match `SCHEDULER_SECRET` regardless
of where it came from — the real boundary, not just belt-and-suspenders.
Since `backend` now also sits on the shared `edge` network for `~/edge-proxy`
to reach, add a block to that Caddyfile blocking `/internal/*` the way
`deploy/Caddyfile` used to, so the secret check isn't the only thing an
internet request has to get past.

Manual trigger:

```bash
docker compose -f docker-compose.prod.yml exec scheduler \
  wget -q -O - --header "X-Scheduler-Secret: $SCHEDULER_SECRET" --post-data= \
  http://backend:8000/internal/tasks/daily-snapshot
```

## 7. Backups & restore

Neon handles this — there's no `db-backup` container or `./backup_data` on
the VPS. Neon takes continuous backups and supports point-in-time restore
(and instant branching) from the Neon console/CLI; confirm the retention
window on your Neon plan covers what you need. To restore a specific dump
manually instead:

```bash
docker compose -f docker-compose.prod.yml stop backend frontend scheduler
pg_restore "<Neon DATABASE_URL>" --clean --if-exists --no-owner fin-2026-07-10.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

## 8. Decommissioning the gcloud deployment

After DNS has moved and the VPS is verified:

```bash
gcloud run services delete backend frontend --region asia-southeast1
gcloud scheduler jobs list && gcloud scheduler jobs delete <daily-snapshot-job>
gcloud secrets delete FINANCE_TRACKER_DB_URL   # after confirming the dump restored
# Delete the Cloud SQL instance / Artifact Registry repo once you're confident
# the Neon copy is verified and the VPS has been serving successfully.
```

`cloudbuild.yaml` is retained in the repo for reference during the transition
and can be deleted once the gcloud project is wound down.

## Swappable choices

- **Proxy**: Caddy (in the separate `~/edge-proxy` stack) was chosen for
  zero-config TLS, shared across whatever else runs on this VPS. To use
  Traefik/nginx instead, that's entirely a change to `~/edge-proxy`; this
  repo only needs something on the `edge` network forwarding to
  `frontend:8080`, `backend:8000` and `webhook:9000` by hostname.
- **Build location**: images build on the VPS. If the VPS is RAM-constrained
  (frontend build wants ~2 GB), build in CI, push to a registry (e.g. GHCR),
  and swap `build:` for `image:` in `docker-compose.prod.yml`.
- **Database**: Neon was chosen over a local `postgres` container for its
  fast suspend/resume (sub-second to low-single-digit-second cold start on a
  scaled-to-zero compute, versus a full container boot) and managed PITR
  backups. To self-host Postgres on the VPS instead, reintroduce a `db`
  service (see git history for the last version of this compose file that
  had one) and point `DATABASE_URL` at it.
