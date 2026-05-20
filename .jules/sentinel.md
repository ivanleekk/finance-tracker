## 2024-05-20 - [Exception string leakage prevention]
**Vulnerability:** Raw exception object strings (`str(e)`) were exposed to the clients in `HTTPException` detail fields.
**Learning:** Returning `str(e)` in an `HTTPException` can inadvertently leak sensitive stack traces, DB queries, or internal logic.
**Prevention:** Catch the actual exception, log it to standard error via the logger, and return a sanitized, generic error message (e.g. `An internal server error occurred`).
