## 2025-02-23 - Form Validation Accessibility Association
**Learning:** When building reusable UI inputs, it's a common accessibility gap to have helper text or error messages visually adjacent but programmatically detached from the input. Screen readers won't announce the helper/error text when the input is focused unless explicitly linked.
**Action:** Always map the input's `aria-describedby` dynamically to the ID of its helper/error text element. Additionally, use `aria-invalid={!!error}` so that the screen reader correctly announces the input's invalid state independently of the styling.
