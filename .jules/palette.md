## 2024-06-10 - Associating Form Inputs with Helper Texts and Errors
**Learning:** Screen readers may not automatically read helper texts or error messages adjacent to input fields. To ensure users are aware of the field's constraints or error state, the input must explicitly reference the descriptive text and signal invalid states.
**Action:** When building or modifying form inputs, properly associate helper texts and error messages with the input element dynamically using 'aria-describedby' and broadcast error states to screen readers using 'aria-invalid'.
