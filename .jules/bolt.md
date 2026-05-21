## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2026-05-21 - [O(N) Hash Map Optimization for Time-Series Aggregation]
**Learning:** In React components rendering historical charts (e.g., Dashboard, Accounts), nesting array methods like `.filter().reduce()` or `.find()` inside a `.map()` loop over all unique dates creates an O(N * M) performance bottleneck that blocks the main thread on large datasets.
**Action:** Pre-compute lookup hash maps for values (e.g. `portfolioByDate` or `balanceUpdatesByDate`) and iterate once over the sorted dates, applying running totals in O(1) time to achieve a single-pass O(N) aggregation.
