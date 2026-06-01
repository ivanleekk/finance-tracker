## 2025-02-28 - [Information Exposure in Exceptions]
**Vulnerability:** Fast API routes (`internal.py`, `portfolio.py`) directly returned raw exception details `str(e)` inside HTTPExceptions (HTTP 500 and 400), potentially leaking sensitive internal stack traces or configuration errors to the client.
**Learning:** Returning `str(e)` in an API response is a common pattern that risks exposing underlying database connection strings, paths, or external service keys if an unexpected system error occurs.
**Prevention:** Always use generic error messages for the `detail` argument in HTTPExceptions, and log the specific exception type or message server-side if needed for debugging.
