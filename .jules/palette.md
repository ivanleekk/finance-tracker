## 2026-05-16 - Dynamic ARIA DescribedBy and Invalid States
**Learning:** When building reusable form components, error messages and helper texts must be programmatically associated with their input using `aria-describedby`. Furthermore, error states must be explicitly broadcast to screen readers via `aria-invalid="true"`. The generated `aria-describedby` IDs should be unique per component instance, e.g. using React.useId().
**Action:** Always associate helper text to inputs using `aria-describedby` with dynamic IDs, and conditionally apply `aria-invalid` based on error state props.
