import { Link, useLoaderData, useSearchParams } from "react-router";
import { Printer, ArrowLeft, Download } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useHousehold } from "../../lib/HouseholdContext";
import { downloadFromApi } from "../../lib/download";
import { cn } from "../../lib/utils";
import type { ReportsLoaderData } from "./reports.loader";

export { reportsLoader as loader } from "./reports.loader";

const PERIODS = [
    { key: "ytd", label: "This year" },
    { key: "last-year", label: "Last year" },
    { key: "12m", label: "Last 12 months" },
    { key: "all", label: "All time" },
] as const;

function periodRange(key: string): { start?: string; end?: string } {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().split("T")[0];
    switch (key) {
        case "last-year":
            return { start: `${today.getFullYear() - 1}-01-01`, end: `${today.getFullYear() - 1}-12-31` };
        case "12m": {
            const start = new Date(today);
            start.setFullYear(start.getFullYear() - 1);
            return { start: iso(start), end: iso(today) };
        }
        case "all":
            return { start: "1970-01-01", end: iso(today) };
        default:
            return {}; // Backend defaults to the current calendar year
    }
}

export default function Reports() {
    const { report } = (useLoaderData() as ReportsLoaderData) || { report: null };
    const { activeHousehold } = useHousehold();
    const [searchParams, setSearchParams] = useSearchParams();
    const activePeriod = searchParams.get("period") || "ytd";

    if (!report) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                <p className="text-base-500 dark:text-base-400">Couldn't generate the report. Try again in a moment.</p>
                <Link to="/settings" className="text-sm font-semibold text-secondary-600 dark:text-secondary-400 hover:underline">Back to settings</Link>
            </div>
        );
    }

    const currency = report.base_currency || activeHousehold?.base_currency || "USD";
    const money = (v: number | null | undefined, digits = 2) =>
        v == null
            ? "—"
            : new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(v));
    const dateFmt = (v: string | null | undefined) =>
        v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

    const selectPeriod = (key: string) => {
        const { start, end } = periodRange(key);
        const next = new URLSearchParams();
        next.set("period", key);
        if (start) next.set("start", start);
        if (end) next.set("end", end);
        setSearchParams(next);
    };

    const gainClass = (v: number | null | undefined) =>
        v == null ? "" : Number(v) >= 0 ? "text-emerald-700" : "text-rose-700";

    const holdingsValue = Number(report.portfolio_value);
    const activeGoals = report.goals.filter(g => g.target_amount != null || Number(g.current_value_home_currency) > 0);

    return (
        <div className="flex-1 flex flex-col overflow-hidden print:overflow-visible print:block">
            {/* Toolbar — never printed */}
            <div className="print:hidden flex items-center justify-between gap-4 flex-wrap border-b border-base-200 dark:border-base-800 bg-white dark:bg-base-950 px-8 py-4">
                <div className="flex items-center gap-4">
                    <Link to="/settings" className="flex items-center gap-1.5 text-sm text-base-500 dark:text-base-400 hover:text-base-900 dark:hover:text-base-50">
                        <ArrowLeft className="h-4 w-4" /> Settings
                    </Link>
                    <h1 className="font-display font-bold text-lg text-base-900 dark:text-base-50">Financial report</h1>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex rounded-lg border border-base-200 dark:border-base-700 overflow-hidden">
                        {PERIODS.map(p => (
                            <button
                                key={p.key}
                                onClick={() => selectPeriod(p.key)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-semibold transition-colors",
                                    activePeriod === p.key
                                        ? "bg-secondary-500 text-white"
                                        : "text-base-600 dark:text-base-300 hover:bg-base-100 dark:hover:bg-base-800",
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => downloadFromApi(`/exports/household/${report.household_id}/csv`)} className="flex items-center gap-1.5">
                        <Download className="h-4 w-4" /> CSV export
                    </Button>
                    <Button variant="cta" size="sm" onClick={() => window.print()} className="flex items-center gap-1.5">
                        <Printer className="h-4 w-4" /> Save as PDF
                    </Button>
                </div>
            </div>

            {/* Paper sheet — always rendered light so screen matches print */}
            <div className="flex-1 overflow-y-auto p-8 print:overflow-visible print:p-0">
                <div id="printable-report" className="mx-auto max-w-3xl bg-white text-neutral-900 rounded-xl shadow-lg print:shadow-none print:rounded-none p-10 print:p-0 space-y-8">
                    {/* Report header */}
                    <header className="border-b-2 border-neutral-900 pb-4">
                        <h1 className="font-display text-2xl font-extrabold tracking-tight">Financial Report</h1>
                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500">
                            <span><span className="font-semibold text-neutral-700">Household:</span> {report.household_name || "—"}</span>
                            <span><span className="font-semibold text-neutral-700">Prepared for:</span> {report.prepared_for}</span>
                            <span><span className="font-semibold text-neutral-700">Period:</span> {dateFmt(report.period_start)} – {dateFmt(report.period_end)}</span>
                            <span><span className="font-semibold text-neutral-700">Generated:</span> {dateFmt(report.generated_at)}</span>
                            <span><span className="font-semibold text-neutral-700">Currency:</span> {currency}</span>
                        </div>
                    </header>

                    {/* Summary */}
                    <section className="grid grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 break-inside-avoid">
                        {[
                            { label: "Net worth", value: money(report.net_worth, 0) },
                            { label: "Total assets", value: money(report.total_assets, 0) },
                            { label: "Total liabilities", value: money(report.total_liabilities, 0) },
                            { label: "Portfolio value", value: money(report.portfolio_value, 0) },
                        ].map(t => (
                            <div key={t.label} className="rounded-lg border border-neutral-200 p-3 min-w-0">
                                <div className="text-[11px] uppercase tracking-wide text-neutral-500">{t.label}</div>
                                <div className="mt-1 font-mono text-base font-semibold break-words">{t.value}</div>
                            </div>
                        ))}
                    </section>

                    {/* Accounts */}
                    <section className="break-inside-avoid-page">
                        <h2 className="font-display text-sm font-bold uppercase tracking-wide border-b border-neutral-300 pb-1 mb-2">Accounts</h2>
                        <div className="overflow-x-auto print:overflow-visible">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                                    <th className="py-1 pr-3 font-semibold">Account</th>
                                    <th className="py-1 pr-3 font-semibold">Type</th>
                                    <th className="py-1 pr-3 font-semibold">As of</th>
                                    <th className="py-1 font-semibold text-right">Balance</th>
                                    <th className="py-1 font-semibold text-right">In {currency}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.accounts.map(a => (
                                    <tr key={a.id} className="border-t border-neutral-100">
                                        <td className="py-1.5">
                                            {a.name}
                                            {a.is_private && <span className="ml-1.5 text-[10px] text-neutral-400">(private)</span>}
                                        </td>
                                        <td className="py-1.5 capitalize text-neutral-600">{a.kind}</td>
                                        <td className="py-1.5 text-neutral-600">{dateFmt(a.balance_as_of)}</td>
                                        <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">
                                            {a.balance == null ? "—" : `${Number(a.balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${a.currency || ""}`}
                                        </td>
                                        <td className={cn("py-1.5 pl-3 text-right font-mono whitespace-nowrap", a.kind === "liability" && "text-rose-700")}>
                                            {a.balance_home_currency == null ? "—" : money(a.kind === "liability" ? -Number(a.balance_home_currency) : a.balance_home_currency)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-neutral-300 font-semibold">
                                    <td className="py-1.5" colSpan={4}>Net worth</td>
                                    <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{money(report.net_worth)}</td>
                                </tr>
                            </tfoot>
                        </table>
                        </div>
                    </section>

                    {/* Portfolio */}
                    {report.holdings.length > 0 && (
                        <section className="break-inside-avoid-page">
                            <h2 className="font-display text-sm font-bold uppercase tracking-wide border-b border-neutral-300 pb-1 mb-2">Portfolio holdings</h2>
                            <div className="overflow-x-auto print:overflow-visible">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                                        <th className="py-1 pr-3 font-semibold">Holding</th>
                                        <th className="py-1 pr-3 font-semibold">Portfolio</th>
                                        <th className="py-1 font-semibold text-right">Qty</th>
                                        <th className="py-1 font-semibold text-right">Value</th>
                                        <th className="py-1 font-semibold text-right">Cost</th>
                                        <th className="py-1 font-semibold text-right">Gain</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.holdings.map((h, i) => (
                                        <tr key={i} className="border-t border-neutral-100">
                                            <td className="py-1.5">
                                                <span className="font-mono font-semibold">{h.ticker}</span>
                                                {h.asset_name && <span className="ml-1.5 text-neutral-500 text-xs">{h.asset_name}</span>}
                                            </td>
                                            <td className="py-1.5 text-neutral-600">{h.sub_portfolio}</td>
                                            <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{Number(h.quantity).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                                            <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{money(h.value_home_currency)}</td>
                                            <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{money(h.cost_basis_home_currency)}</td>
                                            <td className={cn("py-1.5 pl-3 text-right font-mono whitespace-nowrap", gainClass(h.unrealized_gain_home_currency))}>
                                                {money(h.unrealized_gain_home_currency)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2 border-neutral-300 font-semibold">
                                        <td className="py-1.5" colSpan={3}>Total</td>
                                        <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{money(holdingsValue)}</td>
                                        <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{money(report.portfolio_cost_basis)}</td>
                                        <td className={cn("py-1.5 pl-3 text-right font-mono whitespace-nowrap", gainClass(report.portfolio_unrealized_gain))}>
                                            {money(report.portfolio_unrealized_gain)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                            </div>
                        </section>
                    )}

                    {/* Cash flow */}
                    <section className="break-inside-avoid-page">
                        <h2 className="font-display text-sm font-bold uppercase tracking-wide border-b border-neutral-300 pb-1 mb-2">
                            Cash flow · {dateFmt(report.period_start)} – {dateFmt(report.period_end)}
                        </h2>
                        <div className="grid grid-cols-3 gap-4 mb-3">
                            <div>
                                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Income</div>
                                <div className="font-mono font-semibold text-emerald-700">{money(report.income_total)}</div>
                            </div>
                            <div>
                                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Expenses</div>
                                <div className="font-mono font-semibold text-rose-700">{money(report.expense_total)}</div>
                            </div>
                            <div>
                                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Net</div>
                                <div className={cn("font-mono font-semibold", gainClass(report.net_cashflow))}>{money(report.net_cashflow)}</div>
                            </div>
                        </div>
                        {report.cashflow_by_category.length > 0 && (
                            <div className="overflow-x-auto print:overflow-visible">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                                        <th className="py-1 pr-3 font-semibold">Category</th>
                                        <th className="py-1 pr-3 font-semibold">Type</th>
                                        <th className="py-1 font-semibold text-right">Transactions</th>
                                        <th className="py-1 font-semibold text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.cashflow_by_category.map((f, i) => (
                                        <tr key={i} className="border-t border-neutral-100">
                                            <td className="py-1.5">{f.category}</td>
                                            <td className="py-1.5 capitalize text-neutral-600">{f.type}</td>
                                            <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{f.transaction_count}</td>
                                            <td className={cn("py-1.5 pl-3 text-right font-mono whitespace-nowrap", f.type === "income" ? "text-emerald-700" : "text-rose-700")}>
                                                {money(f.total_home_currency)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        )}
                    </section>

                    {/* Dividends */}
                    <section className="break-inside-avoid">
                        <h2 className="font-display text-sm font-bold uppercase tracking-wide border-b border-neutral-300 pb-1 mb-2">Dividend income</h2>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <div className="text-[11px] uppercase tracking-wide text-neutral-500">This period</div>
                                <div className="font-mono font-semibold">{money(report.dividends_period_total)}</div>
                            </div>
                            <div>
                                <div className="text-[11px] uppercase tracking-wide text-neutral-500">All time</div>
                                <div className="font-mono font-semibold">{money(report.dividends_all_time_total)}</div>
                            </div>
                        </div>
                    </section>

                    {/* Goals */}
                    {activeGoals.length > 0 && (
                        <section className="break-inside-avoid-page">
                            <h2 className="font-display text-sm font-bold uppercase tracking-wide border-b border-neutral-300 pb-1 mb-2">Goals</h2>
                            <div className="space-y-3">
                                {activeGoals.map(g => (
                                    <div key={g.id} className="break-inside-avoid">
                                        <div className="flex items-baseline justify-between text-sm">
                                            <span>
                                                {g.name}
                                                {g.is_private && <span className="ml-1.5 text-[10px] text-neutral-400">(private)</span>}
                                                {g.target_date && <span className="ml-1.5 text-xs text-neutral-500">by {dateFmt(g.target_date)}</span>}
                                            </span>
                                            <span className="font-mono">
                                                {money(g.current_value_home_currency, 0)}
                                                {g.target_amount != null && <span className="text-neutral-500"> / {money(g.target_amount, 0)}</span>}
                                            </span>
                                        </div>
                                        {g.progress_percent != null && (
                                            <div className="mt-1 h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                                                <div className="h-full bg-neutral-800" style={{ width: `${Math.min(100, g.progress_percent)}%` }} />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <footer className="border-t border-neutral-200 pt-3 text-[10px] text-neutral-400">
                        Balances and valuations are converted to {currency} using recorded exchange rates. Private items belonging to other household members are excluded. Generated by Finance Tracker.
                    </footer>
                </div>
            </div>
        </div>
    );
}
