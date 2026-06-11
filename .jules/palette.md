
## 2024-05-30 - Form Input Accessibility
**Learning:** Generic input components often lack proper ARIA associations for dynamically rendered helper/error texts, leaving screen reader users unaware of critical context or validation failures.
**Action:** Always dynamically generate an `id` for helper text elements and bind them to the `<input>` using `aria-describedby`, while simultaneously broadcasting validation states with `aria-invalid`.
