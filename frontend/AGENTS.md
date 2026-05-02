# Frontend AI Agent Instructions & Design Handoff

This document contains the source of truth for the Finance Tracker frontend redesign. Any AI agent working on the frontend **must read and adhere to these guidelines** before writing or modifying code.

## 1. Project Goal & Persona
- **App Purpose:** Financial tracker for young adults planning life milestones (e.g., house, retirement) to visualize long-term goal progress.
- **Tone:** Friendly, engaging, professional, trustworthy. UI must feel responsive and alive.
- **Platform:** Responsive Web Application (Desktop-first: 1440px).

## 2. Global Design System (Strict Adherence)
- **Grid System:** Strict **4pt grid** for all margins, paddings, widths, and heights.
- **Sizing Tokens:** 
  - Inputs/Dropdowns: `40px` height.
  - Buttons: `32px` (sm), `40px` (md), `48px` (lg).
  - Badges/Tags: `24px` height with full pill radius (`9999px` or `12px`).
  - Progress Bars: `8px` track height.
- **Border Radii:** Snapped to multiples of 4.
  - Buttons/Inputs: `8px` (`rounded-lg` in standard Tailwind).
  - Cards/Modals: `12px` or `16px`.
- **Typography:**
  - Headings: `Plus Jakarta Sans`.
  - Body: `Inter`.
  - Mono (currency/numbers): `JetBrains Mono` (Optional but recommended).

## 3. Brand Theme & Colors (Scheme A)
The app uses a hot-swappable token architecture overwriting default Tailwind variables.
- **Primary:** Tailwind `Sky` palette (trustworthy blue).
- **Secondary:** Tailwind `Fuchsia` palette (vibrant, modern accent).
- **Neutral:** Tailwind `Mauve` (warm-toned grey) or standard neutral.
- **Semantic:** Success (Green), Warning (Amber), Error (Red), Info (Blue).
*Note: Do not hardcode raw hex values; always use CSS custom properties or Tailwind semantic classes (e.g., `bg-primary-500`, `text-neutral-900`).*

## 4. Component Library Inventory
When building UI, assemble from these established atomic components:
- **Atoms:** Buttons (Primary, Secondary, Ghost, Danger), Inputs (Default, Focused, Error, Disabled), Badges.
- **Molecules:** Form Fields (Label + Input + Error Msg), Stat Cards (Net Worth), Goal Progress Cards (with 8px progress track).
- **Organisms:** Sidebar Navigation, Top Bar (Search + Avatar), Account Cards, Transaction Rows, Data Tables, Standard Modals.

## 5. API-Driven UX Architecture
The UI is strictly mapped to the FastAPI backend schemas (`models.py` / `schemas.py`).
- **Concept:** A `SubPortfolio` = A "Goal" (e.g., Downpayment Fund). 
- **User Model:** Solo-first (one household = one user).
- **Endpoints to Views:**
  - `GET /portfolio/snapshots` → Drives the **Dashboard Net Worth Trend (Area Chart)**.
  - `GET /portfolio/sub-portfolios` → Drives the **Goals Overview** cards (target amount, current balance, target date).
  - `GET /accounts` → Drives the **Linked Accounts** data table and summary cards.
  - `GET /transactions` → Drives the **Recent Transactions** lists.

## 6. Page Layout Specifications (Phase 4)
When constructing pages, follow these approved layouts:
1. **Dashboard:** Hero section containing Net Worth Stat Card and an **Area Chart** for trend. Left column: Active Goal Cards. Right column: Recent Transactions.
2. **Goals Overview:** Header with "Add Goal" CTA. 3-column grid of Goal Progress Cards.
3. **Accounts:** Top row: Summary Stat Cards. Main area: Data Table of all connections.
4. **Authentication:** Centered minimal card layout for Log In and Sign Up (Fields: Name, Email, Password).
5. **Data Entry Modals:** Standardized forms for "Add Goal", "Link Account", and "Add Transaction" using the atomic form field components.

## Agent Directives
- **Check Schemas:** Always verify the Pydantic schemas in `backend/src/schemas.py` before binding API data to the frontend state.
- **Aesthetics Matter:** The design must WOW the user. Ensure smooth hover effects, micro-animations, glassmorphism (if applicable), and flawless 4pt alignment. A basic MVP-looking UI is unacceptable.
