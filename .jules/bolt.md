## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2024-05-18 - Avoid O(N log N) sorts for finding extremums
**Learning:** Finding the maximum or latest value in an array by copying and sorting the array (`[...arr].sort()`) inside a loop or React render method causes significant overhead, particularly when it acts as an `O(N log N)` operation multiplied by parent iterations.
**Action:** Use a single-pass `Array.prototype.reduce()` to find extremums in `O(N)` time and `O(1)` memory instead of creating intermediate arrays and sorting.
