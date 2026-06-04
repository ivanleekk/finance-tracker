## 2026-06-04 - [Information Leakage in Error Responses]
**Vulnerability:** Raw exception details (via `str(e)`) were exposed to users in `HTTPException` detail fields.
**Learning:** Passing `str(e)` or raw error objects into client-facing HTTP responses can leak sensitive stack traces or internal configuration.
**Prevention:** Always log the full exception internally (e.g., `logger.error`) but provide a generic, safe error message to the client.
