## 2025-02-24 - Information Disclosure and Observability Trade-off
**Vulnerability:** Replacing detailed HTTP 500 error messages (like `str(e)`) with generic "Internal server error" messages effectively prevents information disclosure to the client but introduces an observability regression by swallowing the original exception.
**Learning:** Security fixes that hide error details from clients must simultaneously ensure the original error information is preserved on the server side for debugging and monitoring purposes.
**Prevention:** Always pair the removal of client-facing error details with server-side logging (e.g., `logging.error(f"Error occurred: {e}", exc_info=True)`) to maintain both security and observability.
