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

## 9. Staging environment (the `dev` branch, same VPS)

A second stack runs beside production on this box, tracking `dev`, so a change —
and especially a migration — can be exercised end-to-end before it merges to
`main`. It uses `docker-compose.staging.yml`, its own checkout, its own Neon
branch, its own webhook, and joins the same shared `edge` network.

| | Production | Staging |
| --- | --- | --- |
| Checkout | `/home/ubuntu/finance-tracker` | `/home/ubuntu/finance-tracker-staging` |
| Branch | `main` | `dev` |
| Compose file | `docker-compose.prod.yml` | `docker-compose.staging.yml` |
| Env file | `.env.production` | `.env.staging` |
| Project name | `finance-tracker` (from the directory) | `finance-tracker-staging` (top-level `name:`) |
| Frontend | `finance.ivanleekaikiat.com` | `stagfinance.ivanleekaikiat.com` |
| API | `financeapi.ivanleekaikiat.com` | `stagfinanceapi.ivanleekaikiat.com` |
| Database | Neon production branch | Neon **branch** of it |
| Session cookies | `access_token` / `refresh_token` | `staging_access_token` / … |
| Snapshot cron | 01:00 UTC | 03:00 UTC |

### Three things that are easy to get wrong

**Service names must not collide.** Compose always registers a service's own name
as a network alias, in addition to anything under `aliases:`. If staging also
called its services `backend`/`frontend`/`webhook` on the shared `edge` network,
those names would resolve to two IPs each and the edge Caddy would round-robin
**production traffic into staging**. Every service in `docker-compose.staging.yml`
is therefore suffixed `-staging`. This is also why staging needs its own compose
file rather than an override on the production one: Compose overrides merge by
service key, so a service cannot be renamed by an override. The file uses
`extends` to inherit build contexts and environment so the two cannot drift —
note that `extends` *does* inherit `depends_on`, whose entries name production's
service keys, so each `depends_on` there carries `!override`.

**Session cookies collide across the whole zone.** `AUTH_COOKIE_DOMAIN` has to be
the parent domain, because `ivanleekaikiat.com` is the only common ancestor of the
frontend and API hosts. A cookie is keyed by (name, domain, path), so two stacks
under one zone share a single `access_token` cookie and overwrite each other's
session — and a narrower staging subdomain does not help, since the parent-scoped
production cookie is sent to every subdomain regardless, leaving the browser
holding two same-named cookies whose send order is undefined. The fix is
`AUTH_COOKIE_PREFIX` (`backend/src/auth.py` `auth_cookie_names()`), which staging
sets to `staging_` and production leaves unset. `backend/tests/test_auth_routes.py`
pins both the unprefixed default and that a production cookie riding along on the
parent domain does not authenticate against staging.

**Memory, not disk, is the ceiling.** The box has 3.8 GB and the Vite production
build wants ~2 GB, so a staging `--build` can OOM-kill the production backend.
Add swap before running any of this, and note the `mem_limit` on the staging
backend/frontend:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### One-time setup

1. **Neon**: create a branch off the production branch (call it `staging`) with its
   own compute endpoint; copy its pooled connection string. The branch is a
   copy-on-write snapshot that then drifts — **reset it from parent before each
   migration rehearsal**, or you are testing a migration against a database that
   already has it.

2. **Checkout and env file**:

   ```bash
   git clone -b dev <repo-url> /home/ubuntu/finance-tracker-staging
   cd /home/ubuntu/finance-tracker-staging
   git status -sb          # must show `## dev...origin/dev` — the webhook runs `git pull --ff-only`
   cp .env.staging.example .env.staging && nano .env.staging
   ```

   Every secret in it must be freshly generated, not copied from
   `.env.production` — a shared `SECRET_KEY` in particular would let a
   staging-minted token authenticate against production. Verify:

   ```bash
   comm -12 <(grep -hE '^(SECRET_KEY|SCHEDULER_SECRET|WEBHOOK_SECRET)=' \
               /home/ubuntu/finance-tracker/.env.production | sort) \
            <(grep -hE '^(SECRET_KEY|SCHEDULER_SECRET|WEBHOOK_SECRET)=' \
               /home/ubuntu/finance-tracker-staging/.env.staging | sort)
   # must print nothing
   ```

3. **DNS**: `A` records for `stagfinance` and `stagfinanceapi` → the VPS IP. The
   edge Caddy issues certificates over Cloudflare DNS-01, so there is no
   propagation-before-boot ordering constraint.

4. **Edge proxy**: add two site blocks to `~/edge-proxy/Caddyfile`, leaving the
   production ones untouched:

   ```caddyfile
   stagfinance.ivanleekaikiat.com {
   	encode gzip
   	header X-Robots-Tag "noindex, nofollow"
   	reverse_proxy frontend-staging:8080 {
   		lb_try_duration 10s
   	}
   }

   stagfinanceapi.ivanleekaikiat.com {
   	encode gzip
   	header X-Robots-Tag "noindex, nofollow"

   	# Same mutually-exclusive `handle` switch as the production API block,
   	# and for the same reason — see the comment there.
   	handle /internal/* {
   		respond 403
   	}
   	handle /hooks/* {
   		reverse_proxy webhook-staging:9000
   	}
   	handle {
   		reverse_proxy backend-staging:8000 {
   			lb_try_duration 10s
   		}
   	}
   }
   ```

   Reload without dropping production connections:

   ```bash
   docker compose -f ~/edge-proxy/docker-compose.yml exec caddy \
     caddy reload --config /etc/caddy/Caddyfile
   ```

5. **First deploy**:

   ```bash
   cd /home/ubuntu/finance-tracker-staging
   docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build
   ```

6. **Second GitHub webhook**: repo → Settings → Webhooks → Add webhook, payload URL
   `https://stagfinanceapi.ivanleekaikiat.com/hooks/deploy`, staging's own
   `WEBHOOK_SECRET`, just the push event. Both webhooks now receive every push and
   each ignores the other's branch via its `DEPLOY_BRANCH` check.

### Verifying it

```bash
# 1. No routing ambiguity — every line must print 1. Anything else means the
#    edge Caddy can round-robin production traffic into staging.
for h in backend frontend webhook backend-staging frontend-staging webhook-staging; do
  echo -n "$h: "; docker exec edge-proxy-caddy-1 getent hosts $h | wc -l
done

# 2. Production untouched, staging up
curl -I https://finance.ivanleekaikiat.com
curl -I https://stagfinance.ivanleekaikiat.com
curl https://stagfinanceapi.ivanleekaikiat.com/hooks/healthz          # -> ok
curl -o /dev/null -w '%{http_code}\n' \
  https://stagfinanceapi.ivanleekaikiat.com/internal/tasks/daily-snapshot   # -> 403
```

Then, in a browser: log into production, log into staging in another tab, and
reload **both** — each must stay logged in. DevTools → Application → Cookies
should show `access_token` and `staging_access_token` side by side. Finally,
paste the staging cookie's value into a production request and confirm the
secrets really differ:

```bash
curl -o /dev/null -w '%{http_code}\n' -H "Cookie: access_token=<staging value>" \
  https://financeapi.ivanleekaikiat.com/auth/me    # -> 401
```

### Day-to-day

Push to `dev` → staging redeploys. Push to `main` → production redeploys. Watch
either with `docker compose -f <that stack's file> logs -f webhook[-staging]`.

Build cache grows roughly twice as fast with two stacks building; run
`docker builder prune --filter until=168h -f` periodically. Either webhook's
`docker image prune -f` prunes globally, which is harmless (it only removes
dangling images no container uses) but shared between the stacks.

The native clients (`ios/`, `android/`) hardcode the production API base URL;
pointing one at staging is a per-client build-config change.

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
