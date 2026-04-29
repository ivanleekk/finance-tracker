CREATE TYPE "liquidity_status" AS ENUM (
  'liquid',
  'market_liquid',
  'time_locked',
  'retirement'
);

CREATE TYPE "tax_treatment" AS ENUM (
  'taxable',
  'tax_deferred',
  'tax_free'
);

CREATE TABLE "users" (
  "id" integer PRIMARY KEY,
  "email" varchar,
  "preferred_timezone" varchar
);

CREATE TABLE "households" (
  "id" integer PRIMARY KEY,
  "name" varchar,
  "base_currency" varchar,
  "country_code" varchar
);

CREATE TABLE "household_members" (
  "id" integer PRIMARY KEY,
  "user_id" integer,
  "household_id" integer,
  "role" varchar
);

CREATE TABLE "account_access" (
  "id" integer PRIMARY KEY,
  "account_id" integer,
  "user_id" integer,
  "role" varchar
);

CREATE TABLE "portfolio_access" (
  "id" integer PRIMARY KEY,
  "sub_portfolio_id" integer,
  "user_id" integer,
  "role" varchar
);

CREATE TABLE "financial_accounts" (
  "id" integer PRIMARY KEY,
  "household_id" integer,
  "name" varchar,
  "liquidity" liquidity_status,
  "tax_status" tax_treatment,
  "currency" varchar
);

CREATE TABLE "account_balances" (
  "id" integer PRIMARY KEY,
  "account_id" integer,
  "date" date,
  "balance" money
);

CREATE TABLE "categories" (
  "id" integer PRIMARY KEY,
  "household_id" integer,
  "name" varchar,
  "type" varchar
);

CREATE TABLE "transactions" (
  "id" integer PRIMARY KEY,
  "account_id" integer,
  "category_id" integer,
  "date" timestamptz,
  "amount" money,
  "description" varchar
);

CREATE TABLE "assets" (
  "id" integer PRIMARY KEY,
  "ticker" varchar,
  "name" varchar,
  "type" varchar,
  "currency" varchar
);

CREATE TABLE "exchange_rates" (
  "id" integer PRIMARY KEY,
  "base_currency" varchar,
  "target_currency" varchar,
  "date" date,
  "rate" float
);

CREATE TABLE "sub_portfolios" (
  "id" integer PRIMARY KEY,
  "household_id" integer,
  "name" varchar,
  "risk_profile" varchar,
  "target_date" date
);

CREATE TABLE "trades" (
  "id" integer PRIMARY KEY,
  "household_id" integer,
  "sub_portfolio_id" integer,
  "asset_id" integer,
  "account_id" integer,
  "type" varchar,
  "date" timestamptz,
  "quantity" float,
  "price" money,
  "exchange_rate" float
);

CREATE TABLE "portfolio_snapshots" (
  "id" integer PRIMARY KEY,
  "household_id" integer,
  "sub_portfolio_id" integer,
  "asset_id" integer,
  "date" date,
  "quantity" float,
  "current_price" money,
  "exchange_rate_used" float,
  "current_value_home_currency" money,
  "average_cost_basis" money
);

CREATE TABLE "dividends" (
  "id" integer PRIMARY KEY,
  "household_id" integer,
  "sub_portfolio_id" integer,
  "asset_id" integer,
  "account_id" integer,
  "date" timestamptz,
  "amount" money,
  "exchange_rate" float
);

COMMENT ON COLUMN "households"."name" IS 'e.g., ''The Smith Family'' or ''Ivan Personal''';

COMMENT ON COLUMN "household_members"."role" IS 'e.g., ''ADMIN'', ''EDITOR'', ''VIEWER''';

COMMENT ON COLUMN "account_access"."role" IS 'e.g., ''OWNER'', ''VIEWER''';

COMMENT ON COLUMN "portfolio_access"."role" IS 'e.g., ''OWNER'', ''VIEWER''';

COMMENT ON COLUMN "categories"."name" IS 'e.g., ''Transport'', ''Salary'', ''Dividends''';

COMMENT ON COLUMN "categories"."type" IS '''INCOME'' or ''EXPENSE''';

COMMENT ON COLUMN "sub_portfolios"."name" IS 'e.g., ''Core Retirement'', ''House Downpayment'', ''YOLO Crypto''';

COMMENT ON COLUMN "sub_portfolios"."risk_profile" IS 'e.g., ''High'', ''Medium'', ''Low''';

COMMENT ON COLUMN "sub_portfolios"."target_date" IS 'Optional: e.g., 2028-06-01 for the downpayment';

COMMENT ON COLUMN "trades"."sub_portfolio_id" IS 'Which bucket does this trade belong to?';

COMMENT ON COLUMN "portfolio_snapshots"."sub_portfolio_id" IS 'Separates AAPL in your Risky vs Core bags';

COMMENT ON COLUMN "dividends"."sub_portfolio_id" IS 'Assigns cash yield to the specific portfolio';

ALTER TABLE "household_members" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "household_members" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "financial_accounts" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "categories" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trades" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dividends" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "portfolio_snapshots" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "sub_portfolios" ADD FOREIGN KEY ("household_id") REFERENCES "households" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "account_access" ADD FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "account_access" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "portfolio_access" ADD FOREIGN KEY ("sub_portfolio_id") REFERENCES "sub_portfolios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "portfolio_access" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "account_balances" ADD FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "transactions" ADD FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trades" ADD FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dividends" ADD FOREIGN KEY ("account_id") REFERENCES "financial_accounts" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "transactions" ADD FOREIGN KEY ("category_id") REFERENCES "categories" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trades" ADD FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dividends" ADD FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "portfolio_snapshots" ADD FOREIGN KEY ("asset_id") REFERENCES "assets" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trades" ADD FOREIGN KEY ("sub_portfolio_id") REFERENCES "sub_portfolios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "portfolio_snapshots" ADD FOREIGN KEY ("sub_portfolio_id") REFERENCES "sub_portfolios" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dividends" ADD FOREIGN KEY ("sub_portfolio_id") REFERENCES "sub_portfolios" ("id") DEFERRABLE INITIALLY IMMEDIATE;
