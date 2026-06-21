
## $(date +%Y-%m-%d) - Prevent timing attacks and info leakage in internal router
**Vulnerability:** Timing attack possible via string comparison (`!=`) on `verify_scheduler_secret` header, and information leakage via exposing `str(e)` in 500 error `detail` during snapshot tasks.
**Learning:** Always use `secrets.compare_digest` for security tokens, and handle optional headers that could be `None`. Unhandled generic exception details exposed to clients can reveal sensitive system information.
**Prevention:** Use `secrets.compare_digest` with a prior `None` check. Return generic "Internal server error" messages instead of passing raw exception strings to HTTP exceptions. When removing `e` from use, change `except Exception as e:` to `except Exception:` to avoid linter errors.
