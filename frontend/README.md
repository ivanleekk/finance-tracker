# Finance Tracker - Frontend

A premium, state-of-the-art financial dashboard built with React Router v7.

## 🎨 Design Philosophy

Our design prioritizes **rich aesthetics** and **interactive excellence**:
-   **Vibrant Color Palettes**: Using HSL-tailored colors for a modern, sleek feel.
-   **Micro-animations**: Subtle transitions and hover effects using Framer Motion.
-   **Responsive Layout**: Fully adaptive design using Tailwind CSS 4.
-   **Dark Mode Support**: Seamless transition between light and dark themes.

## 🛠 Tech Stack

-   **Framework**: [React 19](https://react.dev/) + [React Router v7 (SSR)](https://reactrouter.com/)
-   **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
-   **Charts**: [Recharts](https://recharts.org/)
-   **Icons**: [Lucide React](https://lucide.dev/)
-   **Package Manager**: [pnpm](https://pnpm.io/)
-   **Build Tool**: [Vite 8](https://vitejs.dev/)

## 🚀 Getting Started

### Prerequisites
- Node.js (v25+)
- `pnpm` installed

### Setup
1.  Install dependencies:
    ```bash
    pnpm install
    ```
2.  Set up environment variables in `.env.development`.
3.  Start development server:
    ```bash
    pnpm run dev
    ```

## 🏗 Key Components

-   **Loaders & Actions**: Strict adherence to React Router v7 data fetching patterns. No `useEffect` for data.
-   **SSR Helpers**: Custom utilities in `ssr-helpers.ts` for handling cookie forwarding and internal Docker networking.
-   **Theme Engine**: Context-based theme management with system preference detection.

## 📊 Analytics

We use **Microsoft Clarity** for behavior analytics. The configuration is located in `src/entry.client.tsx` and can be toggled via the `VITE_CLARITY_ID` environment variable.
