// --- ENUM ALTERNATIVES (Vite-Safe) ---

export const LiquidityStatus = {
  Liquid: "liquid",
  MarketLiquid: "market_liquid",
  TimeLocked: "time_locked",
  Retirement: "retirement",
} as const;
export type LiquidityStatus = typeof LiquidityStatus[keyof typeof LiquidityStatus];

export const TaxTreatment = {
  Taxable: "taxable",
  TaxDeferred: "tax_deferred",
  TaxFree: "tax_free",
} as const;
export type TaxTreatment = typeof TaxTreatment[keyof typeof TaxTreatment];

export const AccountKind = {
  Asset: "asset",
  Liability: "liability",
} as const;
export type AccountKind = typeof AccountKind[keyof typeof AccountKind];

export const TransactionType = {
  Income: "income",
  Expense: "expense",
} as const;
export type TransactionType = typeof TransactionType[keyof typeof TransactionType];

export const HouseholdRoleType = {
  Owner: "owner",
  Editor: "editor",
  Viewer: "viewer",
} as const;
export type HouseholdRoleType = typeof HouseholdRoleType[keyof typeof HouseholdRoleType];

export const AccountRoleType = {
  Owner: "owner",
  Editor: "editor",
  Viewer: "viewer",
} as const;
export type AccountRoleType = typeof AccountRoleType[keyof typeof AccountRoleType];

export const TradeType = {
  Buy: "buy",
  Sell: "sell",
} as const;
export type TradeType = typeof TradeType[keyof typeof TradeType];

export const SplitMode = {
  Even: "even",
  ByIncome: "by_income",
  Custom: "custom",
} as const;
export type SplitMode = typeof SplitMode[keyof typeof SplitMode];

export const HouseholdInviteStatus = {
  Pending: "pending",
  Accepted: "accepted",
  Revoked: "revoked",
} as const;
export type HouseholdInviteStatus = typeof HouseholdInviteStatus[keyof typeof HouseholdInviteStatus];

// The three-way ownership view: private-only, household-only, or merged.
export type ViewMode = "private" | "household" | "blended";


// --- 1. USERS & HOUSEHOLDS ---

export type UserResponse = {
  id: string;
  email: string;
  preferred_timezone: string;
  name: string;
  theme_mode: "light" | "dark" | "system";
  primary_color: string;
  secondary_color: string;
  base_color: string;
  hide_private_from_household: boolean;
  require_face_id_for_vault: boolean;
  default_new_items_private: boolean;
};

export type HouseholdResponse = {
  id: string;
  name: string;
  base_currency: string;
  country_code: string;
  default_funding_account_id?: string;
  default_sub_portfolio_id?: string;
  default_split_mode: SplitMode;
};


export type HouseholdMemberResponse = {
  id: string;
  user_id: string;
  household_id: string;
  role: HouseholdRoleType;
};

export type HouseholdMemberUserResponse = HouseholdMemberResponse & {
  name: string;
  email: string;
};

export type HouseholdInviteResponse = {
  id: string;
  household_id: string;
  email: string;
  role: HouseholdRoleType;
  invited_by_user_id: string;
  status: HouseholdInviteStatus;
  created_at: string;
};

export type HouseholdSplitShareResponse = {
  id: string;
  household_id: string;
  user_id: string;
  share_percent: number;
};

// --- 2. FINANCIAL ACCOUNTS & BALANCES ---

export type AccountResponse = {
  id: string;
  household_id: string;
  name: string;
  liquidity: LiquidityStatus;
  tax_status: TaxTreatment;
  // Liabilities (loans, mortgages) store outstanding balance as a positive
  // number; aggregates subtract them.
  kind: AccountKind;
  currency: string;
  // NULL = shared with the household. Set = private to that user.
  owner_user_id?: string | null;
};

export type BalanceResponse = {
  id: string;
  account_id: string;
  date: string;
  balance: number;
  balance_home_currency?: number;
  is_manual: boolean;
};


export type AccountAccessResponse = {
  id: string;
  account_id: string;
  user_id: string;
  role: string;
};

export type PortfolioAccessResponse = {
  id: string;
  sub_portfolio_id: string;
  user_id: string;
  role: string;
};

// --- 3. CASH FLOW (CATEGORIES & TRANSACTIONS) ---

export type CategoryResponse = {
  id: string;
  household_id: string;
  name: string;
  type: TransactionType;
};

export type TransactionResponse = {
  id: string;
  account_id: string;
  category_id: string;
  date: string;
  amount: number;
  amount_home_currency?: number;
  currency?: string | null;
  exchange_rate?: number | null;
  description: string | null;
  transaction_type: TransactionType;
  transfer_id?: string | null;
};

// --- 4. PORTFOLIO & ASSETS ---

export type AssetResponse = {
  id: string;
  ticker: string;
  name: string;
  type: string;
  currency: string;
  // "market" = priced via yfinance; "manual" = user-recorded prices (unlisted bonds, SSBs)
  pricing_mode: "market" | "manual";
};

export type SubPortfolioResponse = {
  id: string;
  household_id: string;
  name: string;
  risk_profile: string;
  target_date: string | null;
  target_amount: number | null;
  owner_user_id?: string | null;
};

export type TradeResponse = {
  id: string;
  household_id: string;
  sub_portfolio_id: string;
  asset_id: string;
  account_id: string;
  type: TradeType;
  date: string;
  quantity: number;
  price: number;
  currency?: string | null;
  exchange_rate: number;
  transaction_id?: string | null;
  settlement_trade_id?: string | null;
  description?: string | null;
};


export type PortfolioSnapshotResponse = {
  id: string;
  household_id: string;
  sub_portfolio_id: string;
  asset_id: string;
  date: string;
  quantity: number;
  price: number;
  exchange_rate_used: number;
  current_value_home_currency: number;
  average_cost_basis: number;
  average_cost_basis_home_currency: number;
};

export type DividendResponse = {
  id: string;
  household_id: string;
  sub_portfolio_id: string;
  asset_id: string;
  account_id: string;
  date: string;
  amount: number;
  exchange_rate: number;
  per_share_amount?: number | null;
  quantity?: number | null;
  amount_home_currency?: number | null;
  is_manual?: boolean | null;
  cash_trade_id?: string | null;
};

// A future coupon/dividend payment known in advance (bond coupons, SSB step-up
// schedules). Materializes into a real DividendResponse once the date arrives.
export type ScheduledDividendResponse = {
  id: string;
  household_id: string;
  sub_portfolio_id: string;
  asset_id: string;
  account_id: string;
  date: string;
  amount: number;
  description?: string | null;
  dividend_id?: string | null;
  materialized_at?: string | null;
};

export type ExchangeRateResponse = {
  id: string;
  date: string;
  base_currency: string;
  target_currency: string;
  rate: number;
};

export type PerformanceMetrics = {
  simple_return: number;
  time_weighted_return: number;
  money_weighted_return: number;
  volatility: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  treynor_ratio?: number | null; // null when no benchmark data (beta unknown)
  alpha?: number | null; // Jensen's alpha vs benchmark
  beta?: number | null;
  dividend_income?: number;
  dividend_yield?: number;
};

export type SubPortfolioMetricsResponse = {
  sub_portfolio_id: string;
  name: string;
  metrics: PerformanceMetrics;
};

export type PortfolioMetricsResponse = {
  household_id: string;
  overall_metrics: PerformanceMetrics;
  sub_portfolio_metrics: SubPortfolioMetricsResponse[];
};

// --- DATA EXPORT & REPORTS ---

export type ReportAccountRow = {
  id: string;
  name: string;
  kind: AccountKind;
  currency?: string | null;
  liquidity?: LiquidityStatus | null;
  is_private: boolean;
  balance?: number | null;
  balance_home_currency?: number | null;
  balance_as_of?: string | null;
};

export type ReportHoldingRow = {
  sub_portfolio: string;
  ticker: string;
  asset_name?: string | null;
  asset_type?: string | null;
  quantity: number;
  price?: number | null;
  currency?: string | null;
  value_home_currency?: number | null;
  cost_basis_home_currency?: number | null;
  unrealized_gain_home_currency?: number | null;
  as_of: string;
};

export type ReportCategoryFlow = {
  category: string;
  type: TransactionType;
  total_home_currency: number;
  transaction_count: number;
};

export type ReportGoalRow = {
  id: string;
  name: string;
  is_private: boolean;
  target_amount?: number | null;
  target_date?: string | null;
  current_value_home_currency: number;
  progress_percent?: number | null;
};

export type HouseholdReportResponse = {
  household_id: string;
  household_name?: string | null;
  base_currency?: string | null;
  generated_at: string;
  prepared_for: string;
  period_start: string;
  period_end: string;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  accounts: ReportAccountRow[];
  portfolio_value: number;
  portfolio_cost_basis: number;
  portfolio_unrealized_gain: number;
  holdings: ReportHoldingRow[];
  income_total: number;
  expense_total: number;
  net_cashflow: number;
  cashflow_by_category: ReportCategoryFlow[];
  dividends_period_total: number;
  dividends_all_time_total: number;
  goals: ReportGoalRow[];
};

// --- 5. REFERENCE DATA ---

export type CurrencyResponse = {
  code: string;
  name: string;
  symbol: string;
};

export type CountryResponse = {
  code: string;
  name: string;
};
