## 2024-05-21 - [FastAPI Timing Attacks & Info Disclosure]
**Vulnerability:** FastApi endpoints verifying custom auth headers used naive string equality (`!=`), and broad exception handlers returned `str(e)` in 500 errors to the client.
**Learning:** Naive equality operators in python are susceptible to timing attacks allowing attackers to guess secret tokens. Exposing full Exception traces (`str(e)`) via HTTPException exposes internal application structure and data.
**Prevention:** Always use `secrets.compare_digest` for security comparisons and ensure it receives non-None types. Never pass raw exception strings to the client; log them internally instead.
