import { useState, useEffect } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { TopBar } from "../../components/TopBar";
import { useHousehold } from "../../lib/HouseholdContext";
import { useTheme, THEME_PALETTES } from "../../lib/ThemeContext";
import api from "../../lib/api";
import { downloadFromApi } from "../../lib/download";
import { cn } from "../../lib/utils";
import { User, Shield, Globe, Check, Lock, Mail, Palette, Database, EyeOff, ChevronRight } from "lucide-react";
import type { SettingsLoaderData } from "./settings.loader";

export { settingsLoader as loader } from "./settings.loader";

type Section = "General" | "Security" | "Appearance" | "Privacy" | "Data";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "General", label: "General", icon: <User className="h-4 w-4" /> },
    { id: "Security", label: "Security", icon: <Shield className="h-4 w-4" /> },
    { id: "Appearance", label: "Appearance", icon: <Palette className="h-4 w-4" /> },
    { id: "Privacy", label: "Privacy & vault", icon: <EyeOff className="h-4 w-4" /> },
    { id: "Data", label: "Data & connections", icon: <Database className="h-4 w-4" /> },
];

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
    const { user, currencies, timezones, accounts = [] } = (useLoaderData() as SettingsLoaderData) || {};
    const revalidator = useRevalidator();
    const {
        themeMode, primaryColor, secondaryColor, baseColor,
        setPrimaryColor, setSecondaryColor, setBaseColor
    } = useTheme();

    const [activeSection, setActiveSection] = useState<Section>("General");
    const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);

    // General
    const [userName, setUserName] = useState(user.name);
    const [userTimezone, setUserTimezone] = useState(user.preferred_timezone);
    const [householdName, setHouseholdName] = useState(activeHousehold?.name || "");
    const [householdCurrency, setHouseholdCurrency] = useState(activeHousehold?.base_currency || "USD");
    const [isSavingUser, setIsSavingUser] = useState(false);
    const [isSavingHousehold, setIsSavingHousehold] = useState(false);

    // Security
    const [newEmail, setNewEmail] = useState(user.email);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    // Privacy
    const [hidePrivate, setHidePrivate] = useState(user.hide_private_from_household);
    const [defaultPrivate, setDefaultPrivate] = useState(user.default_new_items_private);
    const [savingPrivacy, setSavingPrivacy] = useState(false);

    // Default expense account (preselected in Transactions and ⌘K quick-add)
    const [defaultAccountId, setDefaultAccountId] = useState(user.default_account_id || "");
    const [savingDefaultAccount, setSavingDefaultAccount] = useState(false);

    // FX preview
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

    const handleUpdateUser = async () => {
        setIsSavingUser(true);
        setMessage(null);
        try {
            await api.put('/users', {
                name: userName,
                preferred_timezone: userTimezone,
                theme_mode: themeMode,
                primary_color: primaryColor,
                secondary_color: secondaryColor,
                base_color: baseColor
            });
            setMessage({ text: "Profile updated successfully!", type: "success" });
            revalidator.revalidate();
        } catch (err) {
            console.error(err);
            setMessage({ text: "Failed to update profile.", type: "error" });
        } finally {
            setIsSavingUser(false);
        }
    };

    const handleUpdateSecurity = async () => {
        if (newPassword && newPassword !== confirmPassword) {
            setMessage({ text: "Passwords do not match.", type: "error" });
            return;
        }

        setIsSavingUser(true);
        setMessage(null);
        try {
            const payload: { email?: string; password?: string } = {};
            if (newEmail !== user.email) payload.email = newEmail;
            if (newPassword) payload.password = newPassword;

            if (Object.keys(payload).length === 0) {
                setMessage({ text: "No changes detected.", type: "error" });
                return;
            }

            await api.put('/users', payload);
            setMessage({ text: "Security settings updated successfully!", type: "success" });
            setNewPassword("");
            setConfirmPassword("");
            revalidator.revalidate();
        } catch (err: any) {
            console.error(err);
            setMessage({ text: err.response?.data?.detail || "Failed to update security settings.", type: "error" });
        } finally {
            setIsSavingUser(false);
        }
    };

    const handleUpdateHousehold = async () => {
        if (!activeHousehold) return;
        setIsSavingHousehold(true);
        setMessage(null);
        try {
            await api.put(`/users/households/${activeHousehold.id}`, {
                name: householdName,
                base_currency: householdCurrency
            });
            setMessage({ text: "Household settings updated successfully!", type: "success" });
            revalidator.revalidate();
        } catch (err) {
            console.error(err);
            setMessage({ text: "Failed to update household settings.", type: "error" });
        } finally {
            setIsSavingHousehold(false);
        }
    };

    const savePrivacy = async (patch: Partial<{ hide_private_from_household: boolean; default_new_items_private: boolean }>) => {
        setSavingPrivacy(true);
        try {
            await api.put("/users", patch);
            revalidator.revalidate();
        } finally {
            setSavingPrivacy(false);
        }
    };

    const saveDefaultAccount = async (accountId: string) => {
        setDefaultAccountId(accountId);
        setSavingDefaultAccount(true);
        try {
            await api.put("/users", accountId ? { default_account_id: accountId } : { clear_default_account: true });
            revalidator.revalidate();
        } finally {
            setSavingDefaultAccount(false);
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
                {message && (
                    <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${message.type === 'success'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                        : 'bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
                        }`}>
                        {message.type === 'success' ? <Check className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                        <span className="font-medium">{message.text}</span>
                    </div>
                )}

                <div className="grid gap-8 md:grid-cols-7">
                    {/* Section Navigation */}
                    <Card className="md:col-span-2 h-fit border-base-200/50 shadow-sm backdrop-blur-sm bg-white/50 dark:bg-base-900/50">
                        <CardContent className="p-2">
                            <div className="space-y-1">
                                {SECTIONS.map(section => (
                                    <button
                                        key={section.id}
                                        onClick={() => setActiveSection(section.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                            activeSection === section.id
                                                ? "bg-primary-50 text-primary-600 shadow-sm dark:bg-primary-950/50 dark:text-primary-400"
                                                : "text-base-600 hover:bg-base-50 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-800 dark:hover:text-base-100"
                                        )}
                                    >
                                        {section.icon}
                                        {section.label}
                                        <ChevronRight className={cn("ml-auto h-4 w-4 transition-opacity", activeSection === section.id ? "opacity-100" : "opacity-0")} />
                                    </button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Main Content Area */}
                    <div className="md:col-span-5 space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                        {activeSection === "General" && (
                            <>
                                {/* User Profile Section */}
                                <Card className="border-base-200/50 shadow-sm overflow-hidden group">
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-500 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <CardHeader>
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 rounded-lg">
                                                <User className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <CardTitle>Personal Information</CardTitle>
                                                <CardDescription>Update your personal details and account settings.</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        <div className="grid gap-6 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Display Name</label>
                                                <Input
                                                    value={userName}
                                                    onChange={(e) => setUserName(e.target.value)}
                                                    placeholder="Your name"
                                                    className="bg-base-50/50 dark:bg-base-900/50 border-base-200 dark:border-base-800 focus:bg-white dark:focus:bg-base-900 transition-all"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Account ID</label>
                                                <Input
                                                    value={user.id}
                                                    disabled
                                                    className="bg-base-100/50 border-base-200 cursor-not-allowed opacity-70 text-[10px] font-mono"
                                                />
                                            </div>
                                            <div className="space-y-2 sm:col-span-2">
                                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Preferred Timezone</label>
                                                <Select
                                                    value={userTimezone}
                                                    onChange={setUserTimezone}
                                                    options={timezones.map(tz => ({ value: tz.name, label: tz.label }))}
                                                />
                                            </div>
                                            {activeHousehold && (
                                                <div className="space-y-2 sm:col-span-2">
                                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Default Expense Account</label>
                                                    <p className="text-xs text-base-500 dark:text-base-400 -mt-1 mb-2">Preselected when logging a transaction or using ⌘K.</p>
                                                    <Select
                                                        value={defaultAccountId}
                                                        onChange={saveDefaultAccount}
                                                        disabled={savingDefaultAccount}
                                                        placeholder="None — always ask"
                                                        options={[
                                                            { value: "", label: "None — always ask" },
                                                            ...accounts.map(a => ({ value: a.id, label: a.name })),
                                                        ]}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex justify-end">
                                            <Button
                                                onClick={handleUpdateUser}
                                                disabled={isSavingUser || (userName === user.name && userTimezone === user.preferred_timezone)}
                                                className="bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-200 dark:shadow-none transition-all active:scale-95"
                                            >
                                                {isSavingUser ? "Saving..." : "Save Changes"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Household Settings Section */}
                                {activeHousehold && (
                                    <Card className="border-base-200/50 shadow-sm overflow-hidden group">
                                        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <CardHeader>
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg">
                                                    <Globe className="h-5 w-5" />
                                                </div>
                                                <div>
                                                    <CardTitle>Household Preferences</CardTitle>
                                                    <CardDescription>Configure global settings for {activeHousehold.name}.</CardDescription>
                                                </div>
                                                <Badge variant="outline" className="ml-auto bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400">
                                                    Active Household
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-6">
                                            <div className="grid gap-6 sm:grid-cols-2">
                                                <div className="space-y-2 sm:col-span-2">
                                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Household Name</label>
                                                    <Input
                                                        value={householdName}
                                                        onChange={(e) => setHouseholdName(e.target.value)}
                                                        className="bg-base-50/50 dark:bg-base-900/50 border-base-200 dark:border-base-800 focus:bg-white dark:focus:bg-base-900 transition-all"
                                                    />
                                                </div>
                                                <div className="space-y-2 sm:col-span-2">
                                                    <label className="text-sm font-medium text-base-700 dark:text-base-300">Base Reporting Currency</label>
                                                    <CardDescription className="text-xs mb-2">This currency will be used for all aggregated charts and metrics.</CardDescription>
                                                    <Select
                                                        value={householdCurrency}
                                                        onChange={setHouseholdCurrency}
                                                        options={currencies.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between pt-2 border-t border-base-100 dark:border-base-800 text-sm">
                                                <span className="text-base-500 dark:text-base-400">FX rate source</span>
                                                <span className="text-base-900 dark:text-base-50 font-medium font-mono text-xs">
                                                    {fxRate != null ? `Live · ${fxReference} ${fxRate.toFixed(2)}` : "Live"}
                                                </span>
                                            </div>
                                            <div className="flex justify-end">
                                                <Button
                                                    variant="secondary"
                                                    onClick={handleUpdateHousehold}
                                                    disabled={isSavingHousehold || (householdName === activeHousehold.name && householdCurrency === activeHousehold.base_currency)}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-95"
                                                >
                                                    {isSavingHousehold ? "Saving..." : "Update Household"}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}
                            </>
                        )}

                        {activeSection === "Security" && (
                            <>
                                <Card className="border-base-200/50 shadow-sm overflow-hidden group">
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <CardHeader>
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-lg">
                                                <Lock className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <CardTitle>Security Settings</CardTitle>
                                                <CardDescription>Secure your account with a strong password and verified email.</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-8">
                                        {/* Email Section */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-base-900 dark:text-base-50">
                                                <Mail className="h-4 w-4" />
                                                Email Address
                                            </div>
                                            <div className="grid gap-4 sm:grid-cols-2 items-end">
                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium text-base-500 dark:text-base-400 uppercase tracking-wider">New Email Address</label>
                                                    <Input
                                                        type="email"
                                                        value={newEmail}
                                                        onChange={(e) => setNewEmail(e.target.value)}
                                                        className="bg-base-50/50 dark:bg-base-900/50 border-base-200 dark:border-base-800 focus:bg-white dark:focus:bg-base-900 transition-all"
                                                    />
                                                </div>
                                                <div className="text-xs text-base-500 dark:text-base-400 pb-2 italic">
                                                    Note: Changing your email will require you to log in again with the new credentials.
                                                </div>
                                            </div>
                                        </div>

                                        <div className="h-px bg-base-100 dark:bg-base-800" />

                                        {/* Password Section */}
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-base-900 dark:text-base-50">
                                                <Lock className="h-4 w-4" />
                                                Update Password
                                            </div>
                                            <div className="grid gap-6 sm:grid-cols-2">
                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium text-base-500 dark:text-base-400 uppercase tracking-wider">New Password</label>
                                                    <Input
                                                        type="password"
                                                        value={newPassword}
                                                        onChange={(e) => setNewPassword(e.target.value)}
                                                        placeholder="Minimum 8 characters"
                                                        className="bg-base-50/50 dark:bg-base-900/50 border-base-200 dark:border-base-800 focus:bg-white dark:focus:bg-base-900 transition-all"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs font-medium text-base-500 dark:text-base-400 uppercase tracking-wider">Confirm New Password</label>
                                                    <Input
                                                        type="password"
                                                        value={confirmPassword}
                                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                                        className="bg-base-50/50 dark:bg-base-900/50 border-base-200 dark:border-base-800 focus:bg-white dark:focus:bg-base-900 transition-all"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-4">
                                            <Button
                                                onClick={handleUpdateSecurity}
                                                disabled={isSavingUser || (newEmail === user.email && !newPassword)}
                                                className="bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-200 dark:shadow-none transition-all active:scale-95"
                                            >
                                                {isSavingUser ? "Updating..." : "Update Security Settings"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border-base-200/50 dark:border-base-800 bg-base-50/30 dark:bg-base-900/30">
                                    <CardContent className="p-6 flex items-start gap-4">
                                        <div className="p-2 bg-white dark:bg-base-800 border border-base-200 dark:border-base-700 rounded-lg shadow-sm">
                                            <Shield className="h-5 w-5 text-primary-500 dark:text-primary-400" />
                                        </div>
                                        <div className="space-y-1">
                                            <h4 className="text-sm font-semibold text-base-900 dark:text-base-50">Security Recommendation</h4>
                                            <p className="text-xs text-base-500 dark:text-base-400 leading-relaxed">
                                                We recommend using a unique password for FinTracker that you don't use elsewhere.
                                                Passwords are cryptographically hashed and salted before storage.
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </>
                        )}

                        {activeSection === "Appearance" && (
                            <div className="space-y-8">
                                <Card className="border-base-200/50 shadow-sm overflow-hidden">
                                    <CardHeader>
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 rounded-lg">
                                                <Palette className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <CardTitle>Theme Customization</CardTitle>
                                                <CardDescription>Personalize the look and feel of your dashboard.</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-8">
                                        {/* Palette Selection */}
                                        <div className="grid gap-8 sm:grid-cols-3">
                                            {/* Primary */}
                                            <div className="space-y-4">
                                                <label className="text-sm font-semibold text-base-900 dark:text-base-50">Primary Color</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {THEME_PALETTES.primary.map(color => (
                                                        <button
                                                            key={color}
                                                            onClick={() => setPrimaryColor(color)}
                                                            className={cn(
                                                                "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
                                                                primaryColor === color ? "border-primary-600 scale-110 shadow-md" : "border-transparent"
                                                            )}
                                                            style={{ backgroundColor: `var(--color-${color}-500)` }}
                                                            title={color}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Secondary */}
                                            <div className="space-y-4">
                                                <label className="text-sm font-semibold text-base-900 dark:text-base-50">Secondary Color</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {THEME_PALETTES.secondary.map(color => (
                                                        <button
                                                            key={color}
                                                            onClick={() => setSecondaryColor(color)}
                                                            className={cn(
                                                                "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
                                                                secondaryColor === color ? "border-secondary-600 scale-110 shadow-md" : "border-transparent"
                                                            )}
                                                            style={{ backgroundColor: `var(--color-${color}-500)` }}
                                                            title={color}
                                                        />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Base */}
                                            <div className="space-y-4">
                                                <label className="text-sm font-semibold text-base-900 dark:text-base-50">Base Neutral</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {THEME_PALETTES.base.map(color => (
                                                        <button
                                                            key={color}
                                                            onClick={() => setBaseColor(color)}
                                                            className={cn(
                                                                "w-8 h-8 rounded-full border-2 transition-all hover:scale-110",
                                                                baseColor === color ? "border-base-600 scale-110 shadow-md" : "border-transparent"
                                                            )}
                                                            style={{ backgroundColor: `var(--color-${color}-500)` }}
                                                            title={color}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-4">
                                            <Button
                                                onClick={handleUpdateUser}
                                                disabled={isSavingUser || (
                                                    themeMode === user.theme_mode &&
                                                    primaryColor === user.primary_color &&
                                                    secondaryColor === user.secondary_color &&
                                                    baseColor === user.base_color
                                                )}
                                                className="bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-200 dark:shadow-none transition-all active:scale-95 text-white"
                                            >
                                                {isSavingUser ? "Saving..." : "Apply Appearance"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border-secondary-100 bg-secondary-50/20 dark:bg-secondary-950/10 dark:border-secondary-900/30">
                                    <CardContent className="p-4 flex items-center gap-4 text-secondary-700 dark:text-secondary-400">
                                        <div className="p-2 bg-white dark:bg-base-900 rounded-lg shadow-sm border border-secondary-100 dark:border-secondary-900">
                                            <Palette className="h-5 w-5 text-secondary-500 dark:text-secondary-400" />
                                        </div>
                                        <p className="text-xs font-medium">
                                            Tip: You can preview your theme changes instantly. Remember to click <strong>Apply Appearance</strong> to save them to your account.
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>
                        )}

                        {activeSection === "Privacy" && (
                            <Card className="border-base-200/50 shadow-sm">
                                <CardHeader>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-secondary-100 dark:bg-secondary-900/50 text-secondary-600 dark:text-secondary-400 rounded-lg">
                                            <EyeOff className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <CardTitle>Private vault</CardTitle>
                                            <CardDescription>Controls how your private accounts and goals behave.</CardDescription>
                                        </div>
                                    </div>
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
                                            <div className="text-sm font-medium text-base-900 dark:text-base-50">Default new items to Private</div>
                                            <div className="text-xs text-base-500 dark:text-base-400">Applies to new accounts, goals and ⌘K entries</div>
                                        </div>
                                        <Toggle checked={defaultPrivate} onChange={(v) => { setDefaultPrivate(v); savePrivacy({ default_new_items_private: v }); }} />
                                    </div>
                                    {savingPrivacy && <div className="text-xs text-base-400 pt-1">Saving…</div>}
                                </CardContent>
                            </Card>
                        )}

                        {activeSection === "Data" && (
                            <Card className="border-base-200/50 shadow-sm">
                                <CardHeader>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 rounded-lg">
                                            <Database className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <CardTitle>Connections &amp; data</CardTitle>
                                            <CardDescription>Broker connections, exports and reports.</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-1">
                                    <div className="flex items-center justify-between py-2.5">
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
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
