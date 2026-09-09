#!/usr/bin/env python3
"""Minimal GitHub push-webhook receiver.

Verifies the HMAC-SHA256 signature GitHub sends, checks the pushed ref
matches DEPLOY_BRANCH, and if so re-runs the exact deploy steps from
DEPLOYMENT.md's "Deploying updates" section (git pull, then
`docker compose up -d --build`). No third-party dependencies on purpose —
this container's only job is to sit behind Caddy and react to one webhook,
so stdlib is enough and there's nothing to `pip install` or keep patched.
"""
import hashlib
import hmac
import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"]
DEPLOY_BRANCH = os.environ.get("DEPLOY_BRANCH", "refs/heads/main")
REPO_DIR = os.environ["REPO_DIR"]
ENV_FILE = os.environ.get("ENV_FILE", ".env.production")
COMPOSE_FILE = os.environ.get("COMPOSE_FILE", "docker-compose.prod.yml")
PORT = int(os.environ.get("PORT", "9000"))
MAX_BODY_BYTES = 1_000_000

_deploy_lock = threading.Lock()


def log(msg: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"[{stamp}] {msg}", flush=True)


def run_deploy() -> None:
    # A slow build finishing after a second push landed would otherwise
    # start a second overlapping `docker compose up --build`; skip instead
    # of queuing; the next push (or a manual redeploy) will catch up.
    if not _deploy_lock.acquire(blocking=False):
        log("deploy already in progress, skipping this trigger")
        return
    try:
        log(f"deploy starting for {DEPLOY_BRANCH}")
        steps = [
            ["git", "-C", REPO_DIR, "pull", "--ff-only"],
            [
                "docker", "compose",
                "--env-file", os.path.join(REPO_DIR, ENV_FILE),
                "-f", os.path.join(REPO_DIR, COMPOSE_FILE),
                "up", "-d", "--build",
                # Deliberately excludes `webhook` itself. BuildKit stamps a
                # fresh timestamp into the image config on every build even
                # on a full cache hit, so an unscoped `--build` gives
                # `webhook` a "new" image on every single deploy — and
                # recreating the container that's running this very deploy
                # kills the process mid-run, leaving the rest of the stack
                # stopped. A change to deploy/webhook/* still needs the
                # manual command from "Deploying updates", run once by hand.
                "migrate", "backend", "frontend", "scheduler",
            ],
            ["docker", "image", "prune", "-f"],
        ]
        for step in steps:
            log(f"$ {' '.join(step)}")
            result = subprocess.run(step, cwd=REPO_DIR, capture_output=True, text=True)
            for line in (result.stdout + result.stderr).splitlines():
                log(f"  {line}")
            if result.returncode != 0:
                log(f"step exited {result.returncode}, aborting deploy")
                return
        log("deploy finished")
    finally:
        _deploy_lock.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "deploy-webhook/1.0"

    def log_message(self, fmt, *args):  # route BaseHTTPServer's own logging through log()
        log("%s - %s" % (self.address_string(), fmt % args))

    def _respond(self, code: int, msg: str) -> None:
        body = msg.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/hooks/healthz":
            self._respond(200, "ok")
        else:
            self._respond(404, "not found")

    def do_POST(self):
        if self.path != "/hooks/deploy":
            self._respond(404, "not found")
            return

        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._respond(400, "bad content length")
            return
        body = self.rfile.read(length)

        signature = self.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            log(f"rejected: bad signature from {self.address_string()}")
            self._respond(403, "forbidden")
            return

        event = self.headers.get("X-GitHub-Event", "")
        if event == "ping":
            self._respond(200, "pong")
            return
        if event != "push":
            self._respond(200, "ignored (not a push event)")
            return

        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._respond(400, "bad json")
            return

        if payload.get("ref") != DEPLOY_BRANCH:
            log(f"ignoring push to {payload.get('ref')!r} (watching {DEPLOY_BRANCH!r})")
            self._respond(200, "ignored (wrong branch)")
            return

        log(f"accepted push to {DEPLOY_BRANCH}, triggering deploy")
        self._respond(202, "deploy triggered")
        threading.Thread(target=run_deploy, daemon=True).start()


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(f"listening on :{PORT}, watching {DEPLOY_BRANCH}, repo {REPO_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
