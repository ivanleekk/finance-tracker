## 2025-02-12 - Form Input Accessibility: Dynamic ARIA Binding
**Learning:** Hardcoding static IDs or missing explicit association between inputs and helper texts leads to screen readers failing to provide full context on form elements.
**Action:** When building or modifying form inputs in the future, always dynamically associate helper texts and error messages with the input element using `aria-describedby` based on unique auto-generated IDs and broadcast error states via `aria-invalid`.
