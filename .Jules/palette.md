## 2024-05-07 - Form Input Accessibility
**Learning:** The default Input component in this app was missing proper ARIA bindings between the input element and its helper text, and didn't properly broadcast error states to screen readers. This is a common accessibility pattern that needs to be addressed when building or modifying form inputs.
**Action:** Always ensure that helper texts and error messages are properly associated with the input element dynamically using `aria-describedby` and broadcast error states to screen readers using `aria-invalid`.
