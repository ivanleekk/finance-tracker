## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2025-02-15 - Array Extremum Finding
**Learning:** Using `[...array].sort()` or `Object.keys().sort((a,b) => a.localeCompare(b))` just to find a single extremum (like the latest date or maximum value) forces an unnecessary O(N log N) time complexity and O(N) space complexity (due to shallow copying).
**Action:** When finding a single extremum, always use an O(N) `Array.prototype.reduce()` or simple loop with relational operators (`>` or `<`) to improve performance and avoid unnecessary memory allocations.
