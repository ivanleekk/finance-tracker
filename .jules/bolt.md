## 2024-05-09 - Time-series chart aggregation optimization
**Learning:** Avoid nested `.filter().sort()` inside `.map()` loops when aggregating time-series data for charts. The previous code in `Accounts.tsx` was using an O(N^2 log N) approach, calculating running balances repeatedly for every single date in the chart which blocked the main thread on large datasets.
**Action:** Use an O(N) single-pass approach instead: initialize running balances for each account, iterate through chronologically sorted events to update the running balances, and populate the chart data.
