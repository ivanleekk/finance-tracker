## 2024-05-08 - Accessible Forms
**Learning:** Proper association of helper texts and error messages with input elements using `aria-describedby` dynamically links the message ID and broadcasts error states using `aria-invalid`. This greatly improves accessibility for screen readers on interactive forms.
**Action:** Always dynamically generate and link IDs when creating input/form components with helper/error text so `aria-describedby` can resolve appropriately.
