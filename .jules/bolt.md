## 2024-05-06 - [Fix N+1 query]
**Learning:** Found N+1 query loading multiple accounts then firing multiple balance fetches on frontend instead of batched backend endpoint.
**Action:** Always batch related fetches when querying a list, ideally by providing a batched backend endpoint.
