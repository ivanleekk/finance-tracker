import { useState } from "react"
import { useLoaderData, useRevalidator } from "react-router"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Input } from "../../components/ui/Input"
import { Button } from "../../components/ui/Button"
import { Badge } from "../../components/ui/Badge"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import { User, Shield, Globe, Bell, CreditCard, ChevronRight, Check, Lock, Mail, Palette } from "lucide-react"
import { cn } from "../../lib/utils"
import { useTheme, THEME_PALETTES } from "../../lib/ThemeContext"
import type { UserResponse, HouseholdResponse, CurrencyResponse } from "../../types/types"

export { profileLoader as loader } from "./profile.loader";

export default function Profile() {
    const { user, currencies, timezones } = useLoaderData() as {
        user: UserResponse,
        households: HouseholdResponse[],
        currencies: CurrencyResponse[],
        timezones: { name: string; label: string }[]
    };
    const { activeHousehold } = useHousehold();
    const revalidator = useRevalidator();
    const {
        themeMode, primaryColor, secondaryColor, baseColor,
        setPrimaryColor, setSecondaryColor, setBaseColor
    } = useTheme();

    const [activeSection, setActiveSection] = useState<"General" | "Security" | "Appearance">("General");

    // General States
    const [userName, setUserName] = useState(user.name);
    const [userTimezone, setUserTimezone] = useState(user.preferred_timezone);
    const [householdName, setHouseholdName] = useState(activeHousehold?.name || "");
    const [householdCurrency, setHouseholdCurrency] = useState(activeHousehold?.base_currency || "USD");

    // Security States
    const [newEmail, setNewEmail] = useState(user.email);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [isSavingUser, setIsSavingUser] = useState(false);
    const [isSavingHousehold, setIsSavingHousehold] = useState(false);
    const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);

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
            const payload: any = {};
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

    return (
        <div className="flex-1 space-y-4 md:space-y-8 p-4 md:p-8 pt-6 relative overflow-y-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between space-y-2 md:space-y-0">
                <div>
                    <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-base-900 dark:text-base-50">Profile & Settings</h2>
                    <p className="text-xs sm:text-sm md:text-base text-base-500 dark:text-base-400">Manage your account preferences and household configurations.</p>
                </div>
            </div>

            {message && (
                <div className={`p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${message.type === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800'
                    }`}>
                    {message.type === 'success' ? <Check className="h-5 w-5 shrink-0" /> : <Shield className="h-5 w-5 shrink-0" />}
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            <div className="grid gap-6 md:gap-8 md:grid-cols-7">
                {/* Navigation Sidebar */}
                <Card className="md:col-span-2 h-fit border-base-200/50 shadow-sm backdrop-blur-sm bg-white/50 dark:bg-base-900/50">
                    <CardContent className="p-2 flex flex-row md:flex-col gap-1 overflow-x-auto no-scrollbar">
                        <div className="flex flex-row md:flex-col w-full min-w-max md:min-w-0 space-y-0 md:space-y-1 gap-1 md:gap-0">
                            <button
                                onClick={() => setActiveSection("General")}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-sm font-medium transition-all whitespace-nowrap md:whitespace-normal",
                                    activeSection === "General"
                                        ? "bg-primary-50 text-primary-600 shadow-sm dark:bg-primary-950/50 dark:text-primary-400"
                                        : "text-base-600 hover:bg-base-50 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-800 dark:hover:text-base-100"
                                )}
                            >
                                <User className="h-4 w-4" />
                                General
                                <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform", activeSection === "General" ? "rotate-0 opacity-100" : "rotate-0 opacity-0")} />
                            </button>
                            <button
                                onClick={() => setActiveSection("Security")}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-sm font-medium transition-all whitespace-nowrap md:whitespace-normal",
                                    activeSection === "Security"
                                        ? "bg-primary-50 text-primary-600 shadow-sm dark:bg-primary-950/50 dark:text-primary-400"
                                        : "text-base-600 hover:bg-base-50 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-800 dark:hover:text-base-100"
                                )}
                            >
                                <Shield className="h-4 w-4" />
                                Security
                                <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform", activeSection === "Security" ? "rotate-0 opacity-100" : "rotate-0 opacity-0")} />
                            </button>
                            <button
                                onClick={() => setActiveSection("Appearance")}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-sm font-medium transition-all whitespace-nowrap md:whitespace-normal",
                                    activeSection === "Appearance"
                                        ? "bg-primary-50 text-primary-600 shadow-sm dark:bg-primary-950/50 dark:text-primary-400"
                                        : "text-base-600 hover:bg-base-50 hover:text-base-900 dark:text-base-400 dark:hover:bg-base-800 dark:hover:text-base-100"
                                )}
                            >
                                <Palette className="h-4 w-4" />
                                Appearance
                                <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform", activeSection === "Appearance" ? "rotate-0 opacity-100" : "rotate-0 opacity-0")} />
                            </button>
                            <button disabled className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-sm font-medium transition-all text-base-300 dark:text-base-700 cursor-not-allowed whitespace-nowrap md:whitespace-normal">
                                <Bell className="h-4 w-4" />
                                Notifications
                            </button>
                            <button disabled className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-sm font-medium transition-all text-base-300 dark:text-base-700 cursor-not-allowed whitespace-nowrap md:whitespace-normal">
                                <CreditCard className="h-4 w-4" />
                                Subscription
                            </button>
                        </div>
                    </CardContent>
                </Card>

                {/* Main Content Area */}
                <div className="md:col-span-5 space-y-6 md:space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 w-full">
                    {activeSection === "General" ? (
                        <>
                            {/* User Profile Section */}
                            <Card className="border-base-200/50 shadow-sm overflow-hidden group w-full">
                                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-500 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <CardHeader className="p-4 md:p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 rounded-lg shrink-0">
                                            <User className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <CardTitle className="truncate">Personal Information</CardTitle>
                                            <CardDescription className="truncate">Update your personal details and account settings.</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-6 p-4 md:p-6 pt-0 md:pt-0">
                                    <div className="grid gap-6 md:grid-cols-2">
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
                                        <div className="space-y-2 md:col-span-2">
                                            <label className="text-sm font-medium text-base-700 dark:text-base-300">Preferred Timezone</label>
                                            <select
                                                value={userTimezone}
                                                onChange={(e) => setUserTimezone(e.target.value)}
                                                className="w-full flex h-10 min-h-[44px] sm:min-h-10 rounded-md border border-base-200 dark:border-base-800 bg-base-50/50 dark:bg-base-900/50 px-3 py-2 text-sm text-base-900 dark:text-base-50 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all focus:bg-white dark:focus:bg-base-900"
                                            >
                                                {timezones.map(tz => (
                                                    <option key={tz.name} value={tz.name} className="dark:bg-base-900">{tz.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex justify-end pt-4">
                                        <Button
                                            onClick={handleUpdateUser}
                                            disabled={isSavingUser || (userName === user.name && userTimezone === user.preferred_timezone)}
                                            className="bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-200 dark:shadow-none transition-all active:scale-95 w-full md:w-auto min-h-[44px]"
                                        >
                                            {isSavingUser ? "Saving..." : "Save Changes"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Household Settings Section */}
                            {activeHousehold && (
                                <Card className="border-base-200/50 shadow-sm overflow-hidden group w-full">
                                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <CardHeader className="p-4 md:p-6">
                                        <div className="flex flex-col md:flex-row md:items-center gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                                                    <Globe className="h-5 w-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <CardTitle className="truncate">Household Preferences</CardTitle>
                                                    <CardDescription className="truncate">Configure global settings for {activeHousehold.name}.</CardDescription>
                                                </div>
                                            </div>
                                            <Badge variant="outline" className="md:ml-auto w-fit bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400 mt-2 md:mt-0">
                                                Active Household
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-6 p-4 md:p-6 pt-0 md:pt-0">
                                        <div className="grid gap-6 md:grid-cols-2">
                                            <div className="space-y-2 md:col-span-2">
                                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Household Name</label>
                                                <Input
                                                    value={householdName}
                                                    onChange={(e) => setHouseholdName(e.target.value)}
                                                    className="bg-base-50/50 dark:bg-base-900/50 border-base-200 dark:border-base-800 focus:bg-white dark:focus:bg-base-900 transition-all"
                                                />
                                            </div>
                                            <div className="space-y-2 md:col-span-2">
                                                <label className="text-sm font-medium text-base-700 dark:text-base-300">Base Reporting Currency</label>
                                                <CardDescription className="text-xs mb-2">This currency will be used for all aggregated charts and metrics.</CardDescription>
                                                <select
                                                    value={householdCurrency}
                                                    onChange={(e) => setHouseholdCurrency(e.target.value)}
                                                    className="w-full flex h-10 min-h-[44px] sm:min-h-10 rounded-md border border-base-200 dark:border-base-800 bg-base-50/50 dark:bg-base-900/50 px-3 py-2 text-sm text-base-900 dark:text-base-50 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all focus:bg-white dark:focus:bg-base-900"
                                                >
                                                    {currencies.map(c => (
                                                        <option key={c.code} value={c.code} className="dark:bg-base-900">
                                                            {c.code} - {c.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="flex justify-end">
                                            <Button
                                                variant="secondary"
                                                onClick={handleUpdateHousehold}
                                                disabled={isSavingHousehold || (householdName === activeHousehold.name && householdCurrency === activeHousehold.base_currency)}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 dark:shadow-none transition-all active:scale-95 w-full md:w-auto"
                                            >
                                                {isSavingHousehold ? "Saving..." : "Update Household"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </>
                    ) : activeSection === "Appearance" ? (
                        <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 w-full overflow-hidden">
                            <Card className="border-base-200/50 shadow-sm overflow-hidden w-full">
                                <CardHeader className="p-4 md:p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400 rounded-lg shrink-0">
                                            <Palette className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <CardTitle className="truncate">Theme Customization</CardTitle>
                                            <CardDescription className="truncate">Personalize the look and feel of your dashboard.</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-6 md:space-y-8 p-4 md:p-6 pt-0 md:pt-0">


                                    {/* Palette Selection */}
                                    <div className="grid gap-8 lg:grid-cols-3">
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
                                            className="bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-200 dark:shadow-none transition-all active:scale-95 text-white w-full md:w-auto"
                                        >
                                            {isSavingUser ? "Saving..." : "Apply Appearance"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-secondary-100 bg-secondary-50/20 dark:bg-secondary-950/10 dark:border-secondary-900/30 w-full">
                                <CardContent className="p-4 flex items-center gap-4 text-secondary-700 dark:text-secondary-400">
                                    <div className="p-2 bg-white dark:bg-base-900 rounded-lg shadow-sm border border-secondary-100 dark:border-secondary-900 shrink-0">
                                        <Palette className="h-5 w-5 text-secondary-500 dark:text-secondary-400" />
                                    </div>
                                    <p className="text-xs font-medium leading-relaxed">
                                        Tip: You can preview your theme changes instantly. Remember to click <strong>Apply Appearance</strong> to save them to your account.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    ) : (
                        <>
                            {/* Security Settings Section */}
                            <Card className="border-base-200/50 shadow-sm overflow-hidden group w-full">
                                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <CardHeader className="p-4 md:p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 rounded-lg shrink-0">
                                            <Lock className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <CardTitle className="truncate">Security Settings</CardTitle>
                                            <CardDescription className="truncate">Secure your account with a strong password and verified email.</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-6 md:space-y-8 p-4 md:p-6 pt-0 md:pt-0">
                                    {/* Email Section */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-base-900 dark:text-base-50">
                                            <Mail className="h-4 w-4" />
                                            Email Address
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-2 items-end">
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
                                        <div className="grid gap-6 md:grid-cols-2">
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
                                            className="bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-200 dark:shadow-none transition-all active:scale-95 w-full md:w-auto"
                                        >
                                            {isSavingUser ? "Updating..." : "Update Security Settings"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Additional Security Info */}
                            <Card className="border-base-200/50 dark:border-base-800 bg-base-50/30 dark:bg-base-900/30 w-full">
                                <CardContent className="p-4 md:p-6 flex items-start gap-4">
                                    <div className="p-2 bg-white dark:bg-base-800 border border-base-200 dark:border-base-700 rounded-lg shadow-sm shrink-0">
                                        <Shield className="h-5 w-5 text-primary-500 dark:text-primary-400" />
                                    </div>
                                    <div className="space-y-1 min-w-0">
                                        <h4 className="text-sm font-semibold text-base-900 dark:text-base-50 truncate">Security Recommendation</h4>
                                        <p className="text-xs text-base-500 dark:text-base-400 leading-relaxed">
                                            We recommend using a unique password for FinTracker that you don't use elsewhere.
                                            Passwords are cryptographically hashed and salted before storage.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
