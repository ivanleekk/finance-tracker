# Talks to the *host's* Docker daemon over the bind-mounted socket (see
# REPO_DIR note in docker-compose.prod.yml), so it needs the `docker`
# CLI + compose plugin rather than its own Docker Engine — docker:*-cli
# ships exactly that. git/openssh-client let it pull over SSH using the
# host's mounted ~/.ssh.
FROM docker:27-cli
RUN apk add --no-cache python3 git openssh-client
# git runs as root in here but REPO_DIR is bind-mounted from the host, owned
# by the host user (not root) — git's dubious-ownership guard blocks `pull`
# on a directory it doesn't own unless it's allow-listed. `*` rather than the
# specific REPO_DIR path because that path is only known at container
# runtime (from .env.production), not at this build step.
RUN git config --system --add safe.directory '*'
COPY server.py /app/server.py
CMD ["python3", "/app/server.py"]
