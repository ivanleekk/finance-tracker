## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2025-05-12 - [O(N^2) mapping logic for chart data]
**Learning:** Nested `.filter()`, `.reduce()` and `.find()` calls inside iterating loops for mapping time-series chart data can block the main thread by introducing an O(N^2) complexity on large datasets.
**Action:** Always pre-group array data using Hash Maps (`new Map()`) outside the loop, and maintain running balances to avoid redundant iterations inside the mapping logic, allowing the logic to operate with an O(N) complexity.
