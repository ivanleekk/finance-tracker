## 2026-06-02 - Prevent Timing Attacks in Header Secrets
**Vulnerability:** Comparing sensitive headers (like secrets) with `!=` allows for timing attacks, and raw exceptions leaked internal state.
**Learning:** Always use `secrets.compare_digest` for comparing secrets, handling `None` first. Also never leak `str(e)` in HTTP exceptions.
**Prevention:** Utilize standard secure constant-time comparison methods and generic error messages.
