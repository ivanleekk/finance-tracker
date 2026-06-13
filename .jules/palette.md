## 2024-06-13 - [Dynamic Input Accessibility]
**Learning:** When creating reusable UI components (like `Input`) that accept optional helper text or error messages, it is critical to dynamically generate an ID for the helper text element and append it to the `aria-describedby` attribute of the input element. Ensure that any user-provided `aria-describedby` props are merged correctly to prevent overwriting existing accessibility bindings.
**Action:** Always verify that standard UI form components properly map their related helper/error states to `aria-invalid` and `aria-describedby`.
