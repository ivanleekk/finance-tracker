## 2025-05-30 - [Timing Attack and Information Leakage in API Endpoints]
**Vulnerability:** Use of simple '!=' to compare secrets and leaking raw exception stack traces via HTTP response details.
**Learning:** Python's string equality '!=' is susceptible to timing attacks when verifying secrets. Also, raising an HTTPException with 'detail=str(e)' can expose sensitive backend configuration or API failures directly to clients.
**Prevention:** Always use 'secrets.compare_digest' for comparing secrets (and handle None values explicitly) and use generic error messages for HTTPExceptions.
