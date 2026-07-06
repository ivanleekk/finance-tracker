## 2024-05-06 - [Fix N+1 query]
**Learning:** Found N+1 query loading multiple accounts then firing multiple balance fetches on frontend instead of batched backend endpoint.
**Action:** Always batch related fetches when querying a list, ideally by providing a batched backend endpoint.
## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.
## 2024-05-19 - JavaScript String Comparison Performance
**Learning:** In highly iterative render cycles or sorting algorithms (like rendering a chart with thousands of historical data points), using `String.prototype.localeCompare` on ISO date strings is a significant and unnecessary main-thread bottleneck compared to native lexical operators (`>` and `<`). Additionally, creating full array copies just to `.sort()` them when you only need to extract a single extremum (e.g. the most recent date) creates huge `O(N log N)` overhead.
**Action:** When working with standardized formats like ISO-8601 dates in JS/TS, always use `>` and `<` for comparison. For finding a single min/max value, use an `O(N)` single-pass `Array.prototype.reduce()` (with appropriate empty array safety checks) instead of `.sort()[0]`.

## 2024-07-04 - Optimize Chart Data Aggregation
**Learning:** Using nested array operations like `.find()` or `.filter()` inside a `.map()` loop for large time-series datasets causes O(N^2) complexity, leading to main-thread blocking. Additionally, using `localeCompare` for standard ISO date strings adds unnecessary overhead compared to relational operators (`<`, `>`).
**Action:** Use an O(N) single-pass approach with a hash map (Map) to pre-compute and track running tallies for chart data aggregation. Replace `localeCompare` with standard relational operators for faster date string comparisons.
