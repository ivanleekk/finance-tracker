
## 2024-06-06 - [Timing Attack and Info Disclosure in Internal Tasks]
**Vulnerability:** The internal snapshot scheduling endpoint `backend/src/routers/internal.py` was vulnerable to timing attacks due to the use of a simple string inequality (`!=`) operator to compare the `x_scheduler_secret` header. Furthermore, an information disclosure vulnerability was present in the exception block, exposing the internal exception details (`detail=str(e)`).
**Learning:** We need to handle `None` checks properly when utilizing `secrets.compare_digest` in FastAPI endpoints where the Header can be missing, and ensure that raw exception messages are not logged out to users or via generic HTTP exceptions.
**Prevention:** Always use constant-time comparison `secrets.compare_digest` for secret tokens, ensuring type handling (checking for falsy values like `None`), and avoid returning `str(e)` inside FastAPI HTTP exceptions.
