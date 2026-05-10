## 2023-10-27 - [Time-Series Chart Aggregation]
**Learning:** Nested array operations like `.filter().sort()` inside `.map()` loops when aggregating time-series chart data lead to O(N² log N) complexity, causing main-thread blocking on large datasets.
**Action:** Use a single-pass O(N) approach with pre-sorted arrays and running balance pointers instead of nesting loops.
