## 2024-06-17 - Added Accessibility to Dialog Close Button
**Learning:** Icon-only close buttons in modal dialogs frequently lack ARIA labels, explicit button types (preventing accidental form submission context issues), and keyboard focus indicators, rendering them invisible or confusing to screen readers and keyboard users.
**Action:** Always verify that generic or icon-only `<button>` elements have `type="button"`, a descriptive `aria-label`, and `focus-visible` classes (like `focus-visible:ring-2` with an appropriate ring color) in the underlying UI component libraries.
