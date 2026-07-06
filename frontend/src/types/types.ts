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
  theme_mode: "light" | "dark" | "system";
  primary_color: string;
  secondary_color: string;
  base_color: string;
};

export type HouseholdResponse = {
  id: string;
  name: string;
  base_currency: string;
  country_code: string;
  default_funding_account_id?: string;
  default_sub_portfolio_id?: string;
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
};

export type SubPortfolioResponse = {
  id: string;
  household_id: string;
  name: string;
  risk_profile: string;
  target_date: string | null;
  target_amount: number | null;
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
