import { useState, useEffect } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import api from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import type { SettingsLoaderData } from "./settings.loader";

export { settingsLoader as loader } from "./settings.loader";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-secondary-500" : "bg-base-300 dark:bg-base-700"}`}
        >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
        </button>
    );
}

export default function Settings() {
    const { activeHousehold } = useHousehold();
    const { user, currencies } = (useLoaderData() as SettingsLoaderData) || {};
    const revalidator = useRevalidator();

    const [hidePrivate, setHidePrivate] = useState(user.hide_private_from_household);
    const [requireFaceId, setRequireFaceId] = useState(user.require_face_id_for_vault);
    const [defaultPrivate, setDefaultPrivate] = useState(user.default_new_items_private);
    const [saving, setSaving] = useState(false);

    const baseCurrency = activeHousehold?.base_currency;
    const fxReference = baseCurrency === "USD" ? "EUR" : "USD";
    const [fxRate, setFxRate] = useState<number | null>(null);

    useEffect(() => {
        if (!baseCurrency || baseCurrency === fxReference) return;
        let cancelled = false;
        api.get("/reference/exchange_rate", {
            params: { base: fxReference, target: baseCurrency, date: new Date().toISOString().split("T")[0] }
        }).then(res => {
            if (!cancelled) setFxRate(res.data.rate);
        }).catch(() => {
            if (!cancelled) setFxRate(null);
        });
        return () => { cancelled = true; };
    }, [baseCurrency, fxReference]);

    const savePrivacy = async (patch: Partial<{ hide_private_from_household: boolean; require_face_id_for_vault: boolean; default_new_items_private: boolean }>) => {
        setSaving(true);
        try {
            await api.put("/users", patch);
            revalidator.revalidate();
        } finally {
            setSaving(false);
        }
    };

    const [exporting, setExporting] = useState(false);
    const exportCsv = async () => {
        if (!activeHousehold) return;
        setExporting(true);
        try {
            await downloadFromApi(`/exports/household/${activeHousehold.id}/csv`);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <TopBar title="Settings" commandPlaceholder="Log or find…" />
            <div className="flex-1 overflow-y-auto p-8">
                <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Profile</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-display font-bold">
                                    {user.name?.[0]?.toUpperCase() || "?"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-base-900 dark:text-base-50">{user.name}</div>
                                    <div className="text-sm text-base-500 dark:text-base-400 truncate">{user.email}</div>
                                </div>
                                <Link to="/profile" className="text-sm font-semibold text-secondary-600 dark:text-secondary-400 hover:underline">Edit</Link>
                            </div>
                            <div className="flex items-center justify-between py-2 border-t border-base-100 dark:border-base-800 text-sm">
                                <span className="text-base-500 dark:text-base-400">Theme</span>
                                <span className="text-base-900 dark:text-base-50 font-medium">Dark</span>
                            </div>
                            <div className="flex items-center justify-between py-2 border-t border-base-100 dark:border-base-800 text-sm">
                                <span className="text-base-500 dark:text-base-400">Timezone</span>
                                <span className="text-base-900 dark:text-base-50 font-medium">{user.preferred_timezone}</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Currency &amp; FX</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center justify-between py-2 text-sm">
                                <span className="text-base-500 dark:text-base-400">Base currency</span>
                                <Badge variant="secondary">{activeHousehold?.base_currency || "—"}</Badge>
                            </div>
                            <div className="flex items-center justify-between py-2 border-t border-base-100 dark:border-base-800 text-sm">
                                <span className="text-base-500 dark:text-base-400">FX rate source</span>
                                <span className="text-base-900 dark:text-base-50 font-medium font-mono text-xs">
                                    {fxRate != null ? `Live · ${fxReference} ${fxRate.toFixed(2)}` : "Live"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between py-2 border-t border-base-100 dark:border-base-800 text-sm">
                                <span className="text-base-500 dark:text-base-400">Reference currencies available</span>
                                <span className="text-base-900 dark:text-base-50 font-medium">{currencies.length}</span>
                            </div>
                            <p className="text-xs text-base-400 mt-3">
                                Change your household's base currency from <Link to="/profile" className="text-secondary-600 dark:text-secondary-400 hover:underline">Profile</Link>. All aggregate views convert to this currency using live rates.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>🔒 Private vault</CardTitle>
                            <CardDescription>Controls how your private accounts and goals behave.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            <div className="flex items-center justify-between py-2.5">
                                <div>
                                    <div className="text-sm font-medium text-base-900 dark:text-base-50">Hide private from household</div>
                                    <div className="text-xs text-base-500 dark:text-base-400">Members never see these balances</div>
                                </div>
                                <Toggle checked={hidePrivate} onChange={(v) => { setHidePrivate(v); savePrivacy({ hide_private_from_household: v }); }} />
                            </div>
                            <div className="flex items-center justify-between py-2.5 border-t border-base-100 dark:border-base-800">
                                <div>
                                    <div className="text-sm font-medium text-base-900 dark:text-base-50">Require Face ID for vault</div>
                                    <div className="text-xs text-base-500 dark:text-base-400">Extra unlock on private tab (mobile)</div>
                                </div>
                                <Toggle checked={requireFaceId} onChange={(v) => { setRequireFaceId(v); savePrivacy({ require_face_id_for_vault: v }); }} />
                            </div>
                            <div className="flex items-center justify-between py-2.5 border-t border-base-100 dark:border-base-800">
                                <div>
                                    <div className="text-sm font-medium text-base-900 dark:text-base-50">Default new items to Private</div>
                                    <div className="text-xs text-base-500 dark:text-base-400">Applies to new accounts, goals and ⌘K entries</div>
                                </div>
                                <Toggle checked={defaultPrivate} onChange={(v) => { setDefaultPrivate(v); savePrivacy({ default_new_items_private: v }); }} />
                            </div>
                            {saving && <div className="text-xs text-base-400 pt-1">Saving…</div>}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Connections &amp; data</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            <div className="flex items-center justify-between py-2.5">
                                <span className="text-sm font-medium text-base-900 dark:text-base-50">DBS · SGFinDex</span>
                                <Badge variant="neutral">Not connected</Badge>
                            </div>
                            <div className="flex items-center justify-between py-2.5 border-t border-base-100 dark:border-base-800">
                                <span className="text-sm font-medium text-base-900 dark:text-base-50">IBKR · Flex API</span>
                                <Badge variant="neutral">Not connected</Badge>
                            </div>
                            <div className="flex items-center justify-between py-3 border-t border-base-100 dark:border-base-800">
                                <div>
                                    <div className="text-sm font-medium text-base-900 dark:text-base-50">Export data</div>
                                    <div className="text-xs text-base-500 dark:text-base-400">All accounts, balances, transactions, trades, dividends &amp; goals as CSV</div>
                                </div>
                                <Button variant="secondary" size="sm" onClick={exportCsv} disabled={exporting}>{exporting ? "Exporting…" : "Export CSV (.zip)"}</Button>
                            </div>
                            <div className="flex items-center justify-between py-3 border-t border-base-100 dark:border-base-800">
                                <div>
                                    <div className="text-sm font-medium text-base-900 dark:text-base-50">Financial report</div>
                                    <div className="text-xs text-base-500 dark:text-base-400">Printable summary you can save as a PDF</div>
                                </div>
                                <Link to="/reports"><Button variant="secondary" size="sm">Open report</Button></Link>
                            </div>
                            <p className="text-xs text-base-400">Bank/broker connections aren't wired up yet — balances and trades are entered manually or via ⌘K for now.</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
