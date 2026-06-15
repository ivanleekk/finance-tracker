## 2026-06-15 - Dialog Close Button Accessibility
**Learning:** Icon-only close buttons in modal dialogs (like `Dialog.tsx`) are often overlooked for accessibility. They need explicit `type="button"`, an `aria-label`, and clear `focus-visible` styling since they are typically the first element to receive focus when a dialog opens.
**Action:** Always add `type="button"`, `aria-label`, and `focus-visible` states to floating/icon-only action buttons to ensure keyboard and screen reader accessibility.
