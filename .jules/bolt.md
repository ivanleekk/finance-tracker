## 2024-10-25 - Avoid O(N²) in React Time-Series Aggregation
**Learning:** In the Dashboard, aggregating multiple time-series arrays (cash balances, portfolio snapshots) by filtering and sorting them *inside* a map loop over all unique dates leads to O(N * M log M) complexity, blocking the React main thread for large datasets.
**Action:** Always pre-group and pre-sort time-series arrays. Use a multi-pointer approach to iterate through the dates in O(N + M) time. This drastically reduces the complexity and avoids unneeded operations on every render cycle.
