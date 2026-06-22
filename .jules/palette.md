## 2024-06-22 - [Dialog Accessibility Enhancements]
**Learning:** Found that custom `Dialog` components were missing critical screen reader attributes and focus states for icon buttons.
**Action:** Added `role="dialog"`, `aria-modal="true"`, `aria-hidden="true"` on the backdrop, and proper `type="button"`, `aria-label`, and `focus-visible` styles to the close button to ensure proper accessibility in standard modal patterns.
