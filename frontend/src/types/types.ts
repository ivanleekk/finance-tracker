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


// --- 1. USERS & HOUSEHOLDS ---

export type UserResponse = {
  id: string;
  email: string;
  preferred_timezone: string;
  name: string;
};

export type HouseholdResponse = {
  id: string;
  name: string;
  base_currency: string;
  country_code: string;
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

// --- 2. FINANCIAL ACCOUNTS & BALANCES ---

export type AccountResponse = {
  id: string;
  household_id: string;
  name: string;
  liquidity: LiquidityStatus;
  tax_status: TaxTreatment;
  currency: string;
};

export type BalanceResponse = {
  id: string;
  account_id: string;
  date: string;
  balance: number;
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
  description: string | null;
};

// --- 4. PORTFOLIO & ASSETS ---

export type AssetResponse = {
  id: string;
  ticker: string;
  name: string;
  type: string;
  currency: string;
};

export type SubPortfolioResponse = {
  id: string;
  household_id: string;
  name: string;
  risk_profile: string;
  target_date: string | null;
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
  exchange_rate: number;
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
  averge_cost_basis: number;
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
  treynor_ratio: number;
  alpha?: number;
  beta?: number;
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