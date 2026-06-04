## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2024-05-19 - Extremum Finding Optimization
**Learning:** Using `[...array].sort((a,b) => ...)` to find a single max or min value (like the most recent balance or date) inside a React `useMemo` or loop is highly inefficient. It creates an unnecessary shallow copy, taking O(N) memory, and takes O(N log N) time, which scales poorly when called frequently across multiple accounts.
**Action:** Always use an O(N) approach like `array.reduce()` or a standard for-loop to find a single extremum value instead of creating a copy and sorting.
