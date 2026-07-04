## 2024-05-24 - Information Disclosure in Internal Snapshot Job
**Vulnerability:** The internal `/tasks/daily-snapshot` endpoint returns the raw stringified exception (`str(e)`) in its 500 error response.
**Learning:** Returning `str(e)` directly to API clients can inadvertently leak stack traces, database query structures, schema details, or other sensitive internal state information that an attacker could use for further exploitation.
**Prevention:** Catch generic exceptions, log them securely internally (with stack traces via `exc_info=True`), and return generic error messages (e.g., "An internal server error occurred") to clients.
