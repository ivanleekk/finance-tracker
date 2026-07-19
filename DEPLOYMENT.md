# Production Deployment (VPS, Docker Compose)

Production runs entirely on a single VPS via `docker-compose.prod.yml`:

| Service     | Image / build                     | Role                                                        |
| ----------- | --------------------------------- | ----------------------------------------------------------- |
| `caddy`     | `caddy:2-alpine`                  | Reverse proxy + automatic HTTPS (Let's Encrypt)             |
| `frontend`  | `frontend/Dockerfile` @production | React Router SSR server on :8080                            |
| `backend`   | `backend/Dockerfile` @production  | FastAPI on :8000, runs `alembic upgrade head` on boot       |
| `db`        | `postgres:18-alpine`              | Database, persisted in the `finance_tracker_prod_db` volume |
| `scheduler` | `alpine:3.21` + crond             | Daily snapshot/dividend job (replaces Cloud Scheduler)      |
| `db-backup` | `postgres:18-alpine`              | Nightly `pg_dump` into `./backup_data`, 14-day retention    |

Only Caddy publishes host ports (80/443). Postgres and the app servers are
reachable solely on the compose network.

## 1. One-time VPS setup

```bash
# Docker Engine + compose plugin (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh

# Firewall: only SSH + HTTP(S)
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

git clone <repo-url> finance-tracker && cd finance-tracker
cp .env.production.example .env.production
# Fill in every value — generate secrets with `openssl rand -hex 32`
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

Run from any machine that can reach the old database (values from the
`FINANCE_TRACKER_DB_URL` secret):

```bash
pg_dump "<old DATABASE_URL>" -Fc -f finance.dump
scp finance.dump vps:~/finance-tracker/backup_data/
```

On the VPS (stop the app so nothing writes mid-restore; keep db up):

```bash
cd ~/finance-tracker
docker compose -f docker-compose.prod.yml stop backend frontend scheduler
docker compose -f docker-compose.prod.yml cp backup_data/finance.dump db:/tmp/finance.dump
docker compose -f docker-compose.prod.yml exec db \
  pg_restore -U fin -d fin --clean --if-exists --no-owner /tmp/finance.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Cutover order: deploy VPS → restore data → verify over HTTPS → flip DNS →
decommission gcloud (below).

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

`db-backup` writes `backup_data/fin-YYYY-MM-DD.dump` nightly and deletes dumps
older than 14 days. Copy them off-host (cron + rclone/rsync) for real safety.

Restore a backup:

```bash
docker compose -f docker-compose.prod.yml stop backend frontend scheduler
docker compose -f docker-compose.prod.yml cp backup_data/fin-2026-07-10.dump db:/tmp/r.dump
docker compose -f docker-compose.prod.yml exec db pg_restore -U fin -d fin --clean --if-exists --no-owner /tmp/r.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

## 7. Decommissioning the gcloud deployment

After DNS has moved and the VPS is verified:

```bash
gcloud run services delete backend frontend --region asia-southeast1
gcloud scheduler jobs list && gcloud scheduler jobs delete <daily-snapshot-job>
gcloud secrets delete FINANCE_TRACKER_DB_URL   # after confirming the dump restored
# Delete the Cloud SQL instance / Artifact Registry repo once you're confident.
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
