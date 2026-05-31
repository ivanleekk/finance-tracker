## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2025-02-28 - Optimizing Array Extremum lookups
**Learning:** Using `reduce` to find extremums inside `useMemo` hooks is a safe optimization, but requires checking for `.length > 0` to prevent `TypeError: Reduce of empty array with no initial value` exceptions when data is empty.
**Action:** Always wrap `.reduce()` implementations intended for extremum finding with ternary operators checking for `.length > 0` or provide safe initial values if returning objects.
