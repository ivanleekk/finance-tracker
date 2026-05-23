
## 2024-05-23 - Timing Attack and Information Disclosure in Internal Routes
**Vulnerability:** Timing attack via basic string comparison (`!=`) on the scheduler secret token, and information disclosure leaking internal error details in API response via `str(e)`.
**Learning:** Python's built-in `!=` operator allows attackers to guess secrets by measuring response times. Returning `str(e)` from exception blocks directly to users exposes internal logic or stack details.
**Prevention:** Use `secrets.compare_digest` for all token/secret comparisons (checking for `None` first), and use standard `logging` for detailed errors while responding with a generic, safe HTTP message to clients.
