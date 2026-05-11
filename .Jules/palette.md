## 2026-05-11 - Input and Dialog Accessibility
**Learning:** Proper association of helper text/errors to inputs is a critical and easy accessibility win for React inputs. Icon-only buttons need an `aria-label`.
**Action:** Always add `aria-invalid` and dynamically generated `aria-describedby` to reusable `Input` components, and `aria-label` to icon-only buttons like Dialog closes.
