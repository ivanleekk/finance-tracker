## 2024-06-14 - Accessible Close Button in Dialog
**Learning:** Found an icon-only button inside the Dialog component that was missing an ARIA label, explicit button type, and focus styles, impacting keyboard navigation and screen reader accessibility.
**Action:** Added `aria-label="Close dialog"`, `type="button"`, and standard focus styles (`focus-visible:ring-2 focus-visible:ring-primary-500`) to the Dialog close button. We should always check generic UI components for accessible icon-only buttons as they are reused widely.
