## 2024-07-01 - Prevent Timing Attacks and Information Disclosure in Internal Endpoints
**Vulnerability:** Internal endpoints used basic string comparison (`!=`) for secrets, making them vulnerable to timing attacks. Exception handlers exposed raw error details (`str(e)`) to clients, risking information disclosure.
**Learning:** Even internal or scheduled endpoints require robust security practices. Using `secrets.compare_digest` prevents timing attacks, and returning generic error messages while logging the actual exception prevents exposing system internals.
**Prevention:** Always use constant-time comparison for secrets and tokens. Never pass raw exception messages or stack traces to HTTP responses; log them internally instead.
