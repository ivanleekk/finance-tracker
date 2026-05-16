## 2024-05-14 - [Timing Attack in Secret Verification]
**Vulnerability:** The internal API scheduler secret verification was using `!=` for string comparison.
**Learning:** String comparison with `==` or `!=` may exit early, revealing information about the expected string character by character through measuring response times. This allows attackers to brute-force a secret token efficiently.
**Prevention:** Always use `secrets.compare_digest` when verifying security tokens, secrets, or passwords to perform a constant-time comparison, preventing timing attacks.
