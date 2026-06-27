## 2024-06-27 - Information disclosure and Timing Attacks
**Vulnerability:** Fast fail on string comparison for secrets opens up timing attacks. Stack traces or exception messages in 500 errors leak system internals.
**Learning:** Checking optional header dependencies with `secrets.compare_digest` requires an explicit `None` check to avoid runtime type errors. Replacing `str(e)` with a generic message requires internal logging (`exc_info=True`) to maintain observability.
**Prevention:** Use `secrets.compare_digest` for all secret comparisons, taking care to handle `None` values correctly. Provide generic HTTP 500 responses and log the actual exceptions.
