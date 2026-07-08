import { useState, useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useAuth } from "../../lib/AuthContext";
import { useHousehold } from "../../lib/HouseholdContext";
import type { OnboardingLoaderData } from "./onboarding.loader";

export { onboardingLoader as loader, onboardingAction as action } from "./onboarding.loader";

const PRESETS = [
    { key: "Cash account", icon: "💰" },
    { key: "Investment account", icon: "📈" },
];

export default function Onboarding() {
    const { currencies = [], userName } = (useLoaderData() as OnboardingLoaderData) || {};
    const { user } = useAuth();
    const { refreshHouseholds } = useHousehold();
    const navigate = useNavigate();
    const fetcher = useFetcher();

    const [step, setStep] = useState<1 | 2>(1);
    const [baseCurrency, setBaseCurrency] = useState("USD");
    const [selectedPresets, setSelectedPresets] = useState<Record<string, string>>({});
    const [defaultPrivate, setDefaultPrivate] = useState(true);
    const [householdId, setHouseholdId] = useState<string | null>(null);
    const [householdName, setHouseholdName] = useState(userName ? `${userName}'s finances` : "My finances");
    const [inviteEmail, setInviteEmail] = useState("");

    useEffect(() => {
        if (fetcher.state === "idle" && fetcher.data?.success && fetcher.data?.householdId) {
            setHouseholdId(fetcher.data.householdId);
            refreshHouseholds();
            setStep(2);
        }
    }, [fetcher.state, fetcher.data]);

    const finish = async () => {
        await refreshHouseholds();
        navigate("/dashboard");
    };

    const togglePreset = (key: string) => {
        setSelectedPresets(prev => {
            const next = { ...prev };
            if (key in next) delete next[key];
            else next[key] = "";
            return next;
        });
    };

    return (
        <div className="min-h-dvh w-full flex items-center justify-center bg-gradient-to-br from-secondary-50 via-white to-primary-50 dark:from-base-950 dark:via-base-950 dark:to-secondary-950/20 p-4">
            <Card className="w-full max-w-lg shadow-xl">
                <CardContent className="pt-8 pb-8">
                    <div className="h-1.5 w-full rounded-full bg-base-100 dark:bg-base-800 mb-6 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-secondary-500 to-secondary-700 transition-all duration-500" style={{ width: step === 1 ? "50%" : "100%" }} />
                    </div>
                    <div className="text-xs font-mono uppercase tracking-wider text-base-400 mb-1">Step {step} / 2</div>

                    {step === 1 ? (
                        <>
                            <h1 className="font-display text-2xl font-extrabold text-base-900 dark:text-base-50 mb-1">Set up in 30 seconds</h1>
                            <p className="text-sm text-base-500 dark:text-base-400 mb-6">Everything here has a smart default — change only what you want.</p>

                            <fetcher.Form method="post">
                                <input type="hidden" name="_intent" value="fastSetup" />
                                <input type="hidden" name="current_user_id" value={user?.id ?? ""} />
                                <input type="hidden" name="household_name" value={householdName} />

                                <label className="text-sm font-semibold text-base-900 dark:text-base-50 mb-2 block">Base currency</label>
                                <div className="flex flex-wrap gap-2 mb-6">
                                    {["USD", "SGD", "EUR", "GBP"].map(code => (
                                        <button
                                            type="button"
                                            key={code}
                                            onClick={() => setBaseCurrency(code)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${baseCurrency === code
                                                ? "bg-gradient-to-br from-secondary-500 to-secondary-700 text-white"
                                                : "border border-base-200 dark:border-base-800 text-base-600 dark:text-base-400"
                                                }`}
                                        >
                                            {code}
                                        </button>
                                    ))}
                                    <select
                                        value={currencies.some(c => c.code === baseCurrency) ? baseCurrency : ""}
                                        onChange={(e) => e.target.value && setBaseCurrency(e.target.value)}
                                        className="px-3 py-1.5 rounded-lg text-sm border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 text-base-600 dark:text-base-400"
                                    >
                                        <option value="">More…</option>
                                        {currencies.map(c => <option key={c.code} value={c.code}>{c.code} - {c.name}</option>)}
                                    </select>
                                    <input type="hidden" name="base_currency" value={baseCurrency} />
                                    <input type="hidden" name="country_code" value="US" />
                                </div>

                                <label className="text-sm font-semibold text-base-900 dark:text-base-50 mb-2 block">Add your first account — tap presets, edit balances inline</label>
                                <div className="grid grid-cols-2 gap-3 mb-2">
                                    {PRESETS.map(p => (
                                        <button
                                            type="button"
                                            key={p.key}
                                            onClick={() => togglePreset(p.key)}
                                            className={`text-left p-3 rounded-lg border transition-colors ${p.key in selectedPresets
                                                ? "border-secondary-400 bg-secondary-50 dark:bg-secondary-950/30"
                                                : "border-dashed border-base-300 dark:border-base-700"
                                                }`}
                                        >
                                            <div className="text-sm font-medium text-base-900 dark:text-base-50">{p.icon} {p.key}</div>
                                            {p.key in selectedPresets && (
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    name={`balance_${p.key}`}
                                                    placeholder="0.00"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="mt-2 w-full text-sm bg-transparent border-b border-secondary-300 focus:outline-none"
                                                />
                                            )}
                                        </button>
                                    ))}
                                </div>
                                {Object.keys(selectedPresets).map(key => (
                                    <input key={key} type="hidden" name="preset_account" value={key} />
                                ))}

                                <label className="flex items-center justify-between gap-3 rounded-lg border border-base-200 dark:border-base-800 px-3 py-2.5 mt-4 mb-6 cursor-pointer">
                                    <span className="text-sm text-base-700 dark:text-base-300">New entries are private by default</span>
                                    <input
                                        type="checkbox"
                                        name="default_new_items_private"
                                        checked={defaultPrivate}
                                        onChange={(e) => setDefaultPrivate(e.target.checked)}
                                        className="accent-secondary-500"
                                    />
                                </label>

                                <div className="flex gap-3">
                                    <Button type="submit" variant="secondary" className="flex-1" disabled={fetcher.state !== "idle"} onClick={() => setSelectedPresets({})}>
                                        Skip
                                    </Button>
                                    <Button type="submit" variant="cta" className="flex-1" disabled={fetcher.state !== "idle"}>
                                        {fetcher.state !== "idle" ? "Setting up…" : "Continue"}
                                    </Button>
                                </div>
                            </fetcher.Form>
                        </>
                    ) : (
                        <>
                            <h1 className="font-display text-2xl font-extrabold text-base-900 dark:text-base-50 mb-1">Share with a household?</h1>
                            <p className="text-sm text-base-500 dark:text-base-400 mb-6">
                                Optional. Track shared money with a partner or family, kept separate from your private accounts. You can always do this later.
                            </p>

                            <fetcher.Form method="post" onSubmit={() => setTimeout(finish, 300)}>
                                <input type="hidden" name="_intent" value="finishHousehold" />
                                <input type="hidden" name="household_id" value={householdId ?? ""} />
                                <div className="space-y-4 mb-6">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Household name</label>
                                        <Input name="name" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-base-900 dark:text-base-50">Invite by email (optional)</label>
                                        <Input name="invite_email" type="email" placeholder="partner@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <Button type="button" variant="secondary" className="flex-1" onClick={finish}>Skip for now</Button>
                                    <Button type="submit" variant="cta" className="flex-1">Create &amp; finish</Button>
                                </div>
                            </fetcher.Form>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
