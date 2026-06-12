
## 2024-06-12 - [Timing Attack and Information Disclosure Fix]
**Vulnerability:** The application was vulnerable to timing attacks due to standard string comparison `!=` on a secret header. Additionally, it leaked sensitive internal exception details via `str(e)` in HTTP 500 responses.
**Learning:** Using `!=` on strings compares character by character, which allows attackers to deduce the secret length and content by measuring response times. Returning raw exceptions in HTTP responses can disclose system internals.
**Prevention:** Always use `secrets.compare_digest` for cryptographic comparisons to ensure constant-time checking. Never expose raw error messages (like `str(e)`) in API response details; use generic error messages instead.
