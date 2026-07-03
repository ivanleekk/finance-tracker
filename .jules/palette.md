## 2024-07-03 - Dialog Accessibility Enhancements
**Learning:** Adding standard ARIA modal attributes (`role="dialog"`, `aria-modal="true"`) to modal containers and explicitly hiding background backdrops (`aria-hidden="true"`) significantly improves screen reader navigation and helps correctly trap virtual focus.
**Action:** Always ensure custom modal implementations include these essential ARIA attributes, as well as descriptive `aria-label` attributes on icon-only close buttons, to meet baseline accessibility standards.
