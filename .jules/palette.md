## 2024-07-02 - Dialog Accessibility Improvement
**Learning:** Custom modal components often miss crucial ARIA attributes (`role="dialog"`, `aria-modal="true"`) and background hiding (`aria-hidden="true"` on backdrop), leading to a poor screen reader experience. Icon-only buttons inside them also frequently lack `aria-label`s.
**Action:** When creating or reviewing custom Dialog/Modal components, always ensure they include proper ARIA roles and labels, especially for structural containers and icon-only close buttons.
