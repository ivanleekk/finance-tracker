# Production Deployment (VPS, Docker Compose)

Production runs on a single VPS via `docker-compose.prod.yml`, backed by
**Neon** (managed serverless Postgres) rather than a local database
container:

| Service     | Image / build                     | Role                                                   |
| ----------- | --------------------------------- | ------------------------------------------------------- |
| `caddy`     | `caddy:2-alpine`                  | Reverse proxy + automatic HTTPS (Let's Encrypt)        |
| `frontend`  | `frontend/Dockerfile` @production | React Router SSR server on :8080                       |
| `backend`   | `backend/Dockerfile` @production  | FastAPI on :8000, runs `alembic upgrade head` on boot  |
| `scheduler` | `alpine:3.21` + crond             | Daily snapshot/dividend job (replaces Cloud Scheduler) |

There is no `db` or `db-backup` service: the backend connects directly to
Neon over `DATABASE_URL` (see `.env.production.example`), and Neon's own
point-in-time recovery covers backups — there's no nightly `pg_dump` cron to
maintain on the VPS. Only Caddy publishes host ports (80/443); the app
servers are reachable solely on the compose network.

## 1. One-time VPS setup

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
keep working unchanged.

## 2. First deploy

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f   # watch until healthy
```

The backend container applies Alembic migrations automatically on start, so a
fresh database gets the full schema.

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
Migrations run automatically. Rollback = `git checkout <last-good-sha>` and
re-run the same command (plus a backup restore if a migration must be undone).

## 5. Scheduled jobs

The `scheduler` container fires `POST /internal/tasks/daily-snapshot` at
01:00 UTC daily with the `X-Scheduler-Secret` header. The job catches up from
each household's last snapshot date, so missed runs self-heal. Caddy returns
403 for `/internal/*` from the internet; only the compose-internal call path
works.

Manual trigger:

```bash
docker compose -f docker-compose.prod.yml exec scheduler \
  wget -q -O - --header "X-Scheduler-Secret: $SCHEDULER_SECRET" --post-data= \
  http://backend:8000/internal/tasks/daily-snapshot
```

## 6. Backups & restore

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

## 7. Decommissioning the gcloud deployment

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

- **Proxy**: Caddy was chosen for zero-config TLS. To use Traefik/nginx
  instead, replace the `caddy` service; the app services only need something
  forwarding `frontend:8080` and `backend:8000` by hostname.
- **Build location**: images build on the VPS. If the VPS is RAM-constrained
  (frontend build wants ~2 GB), build in CI, push to a registry (e.g. GHCR),
  and swap `build:` for `image:` in `docker-compose.prod.yml`.
- **Database**: Neon was chosen over a local `postgres` container for its
  fast suspend/resume (sub-second to low-single-digit-second cold start on a
  scaled-to-zero compute, versus a full container boot) and managed PITR
  backups. To self-host Postgres on the VPS instead, reintroduce a `db`
  service (see git history for the last version of this compose file that
  had one) and point `DATABASE_URL` at it.
