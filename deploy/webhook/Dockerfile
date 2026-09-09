# Talks to the *host's* Docker daemon over the bind-mounted socket (see
# REPO_DIR note in docker-compose.prod.yml), so it needs the `docker`
# CLI + compose plugin rather than its own Docker Engine — docker:*-cli
# ships exactly that. git/openssh-client let it pull over SSH using the
# host's mounted ~/.ssh.
FROM docker:27-cli
RUN apk add --no-cache python3 git openssh-client
COPY server.py /app/server.py
CMD ["python3", "/app/server.py"]
