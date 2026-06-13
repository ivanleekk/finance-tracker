## 2025-02-28 - Information Disclosure via Exception Serialization
**Vulnerability:** Global exception catch blocks raised HTTP exceptions exposing the internal exception state (`detail=str(e)`).
**Learning:** Developers frequently serialize caught exceptions for easy debugging, inadvertently logging database schemas, backend structures, or tracebacks to the client.
**Prevention:** In API layer routers, always map backend exceptions to generic user-facing `HTTPException` detail strings (e.g., "Internal Server Error" or "Invalid format") and delegate the logging of raw `str(e)` to internal APM or stdout loggers.

## 2025-02-28 - Fast-Path Timing Attacks via != comparison
**Vulnerability:** Fast-path string comparison (`!=` or `==`) was used to validate cryptographic scheduler secrets in the internal router.
**Learning:** Standard string comparators return early as soon as a mismatch is found. This enables timing attacks where an attacker can determine the secret length and content by measuring network latency.
**Prevention:** Always enforce constant-time execution using `secrets.compare_digest()` for tokens, keys, passwords, and webhooks. Additionally, explicitly handle `None` values (e.g., `if val is None or not secrets.compare_digest(...)`) to prevent TypeErrors during constant-time comparisons.
