## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2024-06-28 - ISO Date String Sorting Optimization
**Learning:** The `localeCompare` function is significantly slower for comparing standardized ISO 8601 date strings compared to standard relational operators (`>`, `<`) because it involves complex internationalization rules. This causes performance issues in loops and array sorting over large time-series data.
**Action:** When comparing or sorting ISO format date strings, always use standard relational operators instead of `localeCompare` for faster execution.
