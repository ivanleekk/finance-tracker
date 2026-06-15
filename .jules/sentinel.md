## 2024-06-15 - [Prevent Timing Attacks in Secret Verification]
**Vulnerability:** The scheduler secret was being compared using the `!=` operator, which is vulnerable to timing attacks as string comparison short-circuits. Furthermore, the generic catch-all exception leak details to the caller by passing `str(e)` in the `detail` parameter.
**Learning:** Python's standard equality operators check character by character and can return early. In internal.py, exceptions were leaking information.
**Prevention:** Always use `secrets.compare_digest` for security tokens, passwords, and sensitive keys comparison. Ensure that optional dependency variables handle `None` values prior to comparing. Use generic exception details to protect server internals.
