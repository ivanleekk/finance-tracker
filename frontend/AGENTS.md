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
  - `GET /portfolio/snapshots/household/{id}` → Drives the **Dashboard Net Worth Trend (Area Chart)** and aggregate wealth stats.
  - `GET /portfolio/sub-portfolios/household/{id}` → Drives the **Goals Overview** cards (target amount, current balance, target date).
  - `GET /accounts/household/{id}` → Drives the **Linked Accounts** data table and summary cards.
  - `GET /cashflow/transactions/household/{id}` → Drives the **Recent Transactions** lists.

## 6. React Router v7 Server-Side Rendering (SSR) Architecture
The frontend has migrated from Client-Side Rendering (CSR) to React Router v7 SSR. You **MUST** strictly adhere to the following paradigms:

- **Data Fetching (Loaders):** 
  - NEVER use `useEffect` or `useState` for initial data fetching. 
  - All data must be fetched server-side in a `loader` function and passed to the component via `useLoaderData()`.
  - **Efficiency:** Use `Promise.all` in loaders to fetch independent data resources in parallel (e.g., accounts, transactions, and snapshots for the Dashboard).
  - Provide fallback defaults to `useLoaderData()` (e.g., `const { items = [] } = (useLoaderData() as Data) || {}`) to prevent destructuring crashes.
- **Mutations (Actions):** 
  - NEVER use standard `<form onSubmit={...}>` or direct `api.post()` calls in the component. 
  - Use React Router's `<Form method="post">` (or `useFetcher` for modals/inline updates) and handle the mutation in a server-side `action` function.
  - If a route has multiple forms, use a hidden input (`<input type="hidden" name="_intent" value="actionName" />`) to switch logic within the action.
  - **Deletion Pattern:** Use a confirmation modal with a `useFetcher` form to safely handle permanent deletions without full page reloads.
- **Internal Docker Networking:**
  - Because `loader` and `action` functions run in the Node.js SSR server inside a Docker container, they cannot use `localhost:8000`.
  - You MUST use the `getApiUrl(path)` utility from `src/lib/api-url.ts` which dynamically resolves to `http://backend:8000` on the server and `http://localhost:8000` in the browser.
- **Cookie & Session Management:**
  - Server-side fetches do not automatically include browser cookies.
  - In every `loader` and `action`, you MUST manually extract the `Cookie` from the incoming `request.headers` and forward it to the backend fetch.
  - Use `getActiveHouseholdId(request, headers)` from `src/lib/ssr-helpers.ts` to dynamically retrieve the user's active household ID from cookies during SSR.
  - If an action modifies auth state (e.g., Login, Logout) and the backend returns a `Set-Cookie` header, you MUST intercept it and forward it back to the browser in your `redirect()` response.

## 7. Page Layout Specifications (Phase 4)
When constructing pages, follow these approved layouts:
1. **Dashboard:** Hero section containing Net Worth Stat Card and an **Area Chart** for trend. Left column: Active Goal Cards. Right column: Recent Transactions.
2. **Goals Overview:** Header with "Add Goal" CTA. 3-column grid of Goal Progress Cards.
3. **Accounts:** Top row: Summary Stat Cards. Main area: Data Table of all connections.
4. **Authentication:** Centered minimal card layout for Log In and Sign Up (Fields: Name, Email, Password).
5. **Data Entry Modals:** Standardized forms for "Add Goal", "Link Account", and "Add Transaction" using the atomic form field components.

## Agent Directives
- **Check Schemas:** Always verify the Pydantic schemas in `backend/src/schemas.py` before binding API data to the frontend state.
- **Aesthetics Matter:** The design must WOW the user. Ensure smooth hover effects, micro-animations, glassmorphism (if applicable), and flawless 4pt alignment. A basic MVP-looking UI is unacceptable.
