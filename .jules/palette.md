## 2026-05-14 - Dynamic ARIA attributes for form inputs
**Learning:** The Input component needs dynamic `aria-invalid` and `aria-describedby` properties tied to the generated ID to ensure screen readers can read error states and helper texts effectively.
**Action:** Always ensure `aria-describedby` and `aria-invalid` are properly bound to the input components dynamically by checking for errors and generating unique IDs when creating or updating custom form inputs.
