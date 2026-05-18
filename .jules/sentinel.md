## 2025-05-18 - Prevented Timing Attack and Information Leakage in Task Scheduler
**Vulnerability:** A standard string comparison ('!=') was used to validate a secret token, enabling potential timing attacks. Additionally, error details were exposed in exception handlers.
**Learning:** Python's 'secrets.compare_digest' provides constant-time comparison but requires robust handling of optional variables (e.g., 'None') to prevent runtime TypeError in FastAPI endpoints.
**Prevention:** Always implement null checks alongside 'secrets.compare_digest' and use generic error messages for the client interface.
