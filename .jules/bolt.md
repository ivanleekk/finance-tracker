## 2024-05-18 - Time-Series Chart Data Aggregation
**Learning:** In a dashboard or analytics heavy app, computing running balances or aggregating time-series data dynamically in a render loop via nested filters/sorts (e.g. `arr.map(() => accounts.map(() => history.filter().sort()[0]))`) quickly becomes a catastrophic main-thread bottleneck, causing the UI to freeze as historical dataset sizes grow (e.g. `O(D * A * H log H)`).
**Action:** When aggregating multi-dimensional time-series data for chart render loops, always use an O(N) single-pass approach: first extract and sort all unique dates (once), then iterate chronologically over those dates using hash maps to track running state variables (like `accountLatestBalances`). This avoids doing heavy array operations recursively on every data point.

## 2025-02-27 - Dashboard Chart Data Maps
**Learning:** Found nested loops and duplicated filters doing O(N^2) work per render in `Dashboard.tsx` map loop for daily snapshots and balances.
**Action:** When creating raw chart datasets for UI graphs, pre-calculate Maps of relevant state lookup fields (`snapshotsByDate` and `balancesByDateAndAcc`) before entering the time-series `.map()` function to turn `O(N)` queries into `O(1)` map lookups inside the loop.
