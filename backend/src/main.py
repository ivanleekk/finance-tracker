# src/main.py

import json
import math
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from src.routers import accounts, cashflow, portfolio, users, auth, reference, internal, exports

# 1. Grab the current API URL from the environment (default to localhost for dev)
api_url = os.getenv("API_URL", "http://localhost:8000")

app = FastAPI(
    title="Finance Tracker API",
    description="Multi-tenant wealth, banking, and portfolio tracking.",
    version="1.0.0",
    # 2. Pass the dynamic variable here
    servers=[
        {
            "url": api_url, 
            "description": "Finance Tracker API Server"
        },
    ],
)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]

# Beyond the explicit origins above, also allow any localhost/127.0.0.1 port.
# The frontend dev server doesn't always land on the configured port (another
# process already holds it, a second worktree, ad hoc preview tooling, ...),
# and CORS_ORIGINS being a fixed list turns that into an opaque network error
# instead of a clear CORS failure. Scoped to loopback hosts only, so this can't
# widen access for a real deployment - no external origin can present as
# "localhost" to a browser's CORS check.
cors_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

# Compress JSON responses over ~1KB (holdings lists, snapshot history, exports)
# before CORS/auth middleware runs, mainly to help iOS/mobile on slower links.
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _sanitize_non_finite(obj):
    """Recursively replace NaN/Infinity floats with a placeholder string so an
    error/response body can always be JSON-serialized. Pydantic validation
    errors echo the offending input, which for a rejected Infinity would
    otherwise make the *error response itself* un-encodable and 500."""
    if isinstance(obj, float) and not math.isfinite(obj):
        return f"<non-finite:{obj}>"
    if isinstance(obj, dict):
        return {k: _sanitize_non_finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_non_finite(v) for v in obj]
    return obj


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # jsonable_encoder turns exceptions/objects in the error context into plain
    # data; _sanitize_non_finite then scrubs any non-finite floats (e.g. a value
    # that overflowed to inf during JSON parsing) before serialization.
    errors = _sanitize_non_finite(jsonable_encoder(exc.errors()))
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": errors},
    )


class _NonFiniteJSONToken(ValueError):
    pass


def _reject_non_finite_token(_value):
    # json.loads calls parse_constant for the bare tokens NaN / Infinity /
    # -Infinity. Reject them outright so poison numbers never enter the app,
    # regardless of whether the target field happens to be finite-guarded.
    raise _NonFiniteJSONToken()


@app.middleware("http")
async def reject_non_finite_json(request: Request, call_next):
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type.lower():
        body = await request.body()
        if body:
            try:
                json.loads(body, parse_constant=_reject_non_finite_token)
            except _NonFiniteJSONToken:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "Non-finite numbers (NaN/Infinity) are not allowed"},
                )
            except ValueError:
                # Malformed JSON -- let the normal request handling surface it.
                pass
    return await call_next(request)


# Connect the modular routers
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(accounts.router)
app.include_router(cashflow.router)
app.include_router(portfolio.router)
app.include_router(reference.router)
app.include_router(internal.router)
app.include_router(exports.router)


@app.get("/")
def read_root():
    return {"status": "online", "message": "Welcome to the Finance Tracker API"}
