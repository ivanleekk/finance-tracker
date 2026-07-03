## 2024-10-24 - Timing Attacks in Optional Headers and Exception Information Disclosure
**Vulnerability:**
1. Timing attack in scheduler secret verification due to using standard `!=` string comparison instead of a constant-time check.
2. Information disclosure by leaking raw exception details (`str(e)`) to the client during a 500 Internal Server Error.
**Learning:**
1. When comparing optional headers (`Header(None)`) with `secrets.compare_digest`, a `None` value can cause runtime type errors.
2. Removing raw exception details might cause linting issues like Ruff's `F841` if `except Exception as e:` isn't changed to `except Exception:`.
**Prevention:**
1. Always check if an optional string dependency is `None` before passing it to `secrets.compare_digest`.
2. When replacing `str(e)` with a generic message, explicitly change the exception block to `except Exception:` and log the original exception using `logger.error(..., exc_info=True)` for system observability.
