## 2024-05-17 - Prevent Timing Attacks in Token Verification
**Vulnerability:** Comparing scheduler secrets (or tokens) using standard equality (`==` or `!=`) exposes the application to timing attacks, as string comparison typically returns early on the first mismatched character.
**Learning:** We need to ensure that secret/token comparisons take constant time regardless of whether the string matches or fails, and where it fails.
**Prevention:** Always use `secrets.compare_digest(a, b)` instead of standard string equality for comparing tokens, secrets, or passwords.
