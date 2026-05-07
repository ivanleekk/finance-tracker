import { useState } from "react"
import { useLoaderData, useRevalidator } from "react-router"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Input } from "../../components/ui/Input"
import { Button } from "../../components/ui/Button"
import { Badge } from "../../components/ui/Badge"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import { User, Shield, Globe, Bell, CreditCard, ChevronRight, Check, Lock, Mail } from "lucide-react"
import { cn } from "../../lib/utils"
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

    const [activeSection, setActiveSection] = useState<"General" | "Security">("General");
    
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
            await api.put('/users/', {
                name: userName,
                preferred_timezone: userTimezone
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

            await api.put('/users/', payload);
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
        <div className="flex-1 space-y-8 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary-600 to-primary-400 bg-clip-text text-transparent">Profile & Settings</h2>
                    <p className="text-base-500">Manage your account preferences and household configurations.</p>
                </div>
            </div>

            {message && (
                <div className={`p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                }`}>
                    {message.type === 'success' ? <Check className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            <div className="grid gap-8 md:grid-cols-7">
                {/* Navigation Sidebar */}
                <Card className="md:col-span-2 h-fit border-base-200/50 shadow-sm backdrop-blur-sm bg-white/50">
                    <CardContent className="p-2">
                        <div className="space-y-1">
                            <button 
                                onClick={() => setActiveSection("General")}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                    activeSection === "General" ? "bg-primary-50 text-primary-600 shadow-sm" : "text-base-600 hover:bg-base-50 hover:text-base-900"
                                )}
                            >
                                <User className="h-4 w-4" />
                                General
                                <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform", activeSection === "General" ? "rotate-0 opacity-100" : "rotate-0 opacity-0")} />
                            </button>
                            <button 
                                onClick={() => setActiveSection("Security")}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                                    activeSection === "Security" ? "bg-primary-50 text-primary-600 shadow-sm" : "text-base-600 hover:bg-base-50 hover:text-base-900"
                                )}
                            >
                                <Shield className="h-4 w-4" />
                                Security
                                <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform", activeSection === "Security" ? "rotate-0 opacity-100" : "rotate-0 opacity-0")} />
                            </button>
                            <button disabled className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all text-base-300 cursor-not-allowed">
                                <Bell className="h-4 w-4" />
                                Notifications
                            </button>
                            <button disabled className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all text-base-300 cursor-not-allowed">
                                <CreditCard className="h-4 w-4" />
                                Subscription
                            </button>
                        </div>
                    </CardContent>
                </Card>

                {/* Main Content Area */}
                <div className="md:col-span-5 space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                    {activeSection === "General" ? (
                        <>
                            {/* User Profile Section */}
                            <Card className="border-base-200/50 shadow-sm overflow-hidden group">
                                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-500 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <CardHeader>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-primary-100 text-primary-600 rounded-lg">
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
                                            <label className="text-sm font-medium text-base-700">Display Name</label>
                                            <Input 
                                                value={userName} 
                                                onChange={(e) => setUserName(e.target.value)} 
                                                placeholder="Your name"
                                                className="bg-base-50/50 border-base-200 focus:bg-white transition-all"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-base-700">Account ID</label>
                                            <Input 
                                                value={user.id} 
                                                disabled 
                                                className="bg-base-100/50 border-base-200 cursor-not-allowed opacity-70 text-[10px] font-mono"
                                            />
                                        </div>
                                        <div className="space-y-2 sm:col-span-2">
                                            <label className="text-sm font-medium text-base-700">Preferred Timezone</label>
                                            <select 
                                                value={userTimezone}
                                                onChange={(e) => setUserTimezone(e.target.value)}
                                                className="w-full flex h-10 rounded-md border border-base-200 bg-base-50/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all focus:bg-white"
                                            >
                                                {timezones.map(tz => (
                                                    <option key={tz.name} value={tz.name}>{tz.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex justify-end">
                                        <Button 
                                            onClick={handleUpdateUser} 
                                            disabled={isSavingUser || (userName === user.name && userTimezone === user.preferred_timezone)}
                                            className="bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-200 transition-all active:scale-95"
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
                                            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                                                <Globe className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <CardTitle>Household Preferences</CardTitle>
                                                <CardDescription>Configure global settings for {activeHousehold.name}.</CardDescription>
                                            </div>
                                            <Badge variant="outline" className="ml-auto bg-indigo-50 border-indigo-100 text-indigo-700">
                                                Active Household
                                            </Badge>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        <div className="grid gap-6 sm:grid-cols-2">
                                            <div className="space-y-2 sm:col-span-2">
                                                <label className="text-sm font-medium text-base-700">Household Name</label>
                                                <Input 
                                                    value={householdName} 
                                                    onChange={(e) => setHouseholdName(e.target.value)}
                                                    className="bg-base-50/50 border-base-200 focus:bg-white transition-all"
                                                />
                                            </div>
                                            <div className="space-y-2 sm:col-span-2">
                                                <label className="text-sm font-medium text-base-700">Base Reporting Currency</label>
                                                <CardDescription className="text-xs mb-2">This currency will be used for all aggregated charts and metrics.</CardDescription>
                                                <select 
                                                    value={householdCurrency}
                                                    onChange={(e) => setHouseholdCurrency(e.target.value)}
                                                    className="w-full flex h-10 rounded-md border border-base-200 bg-base-50/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all focus:bg-white"
                                                >
                                                    {currencies.map(c => (
                                                        <option key={c.code} value={c.code}>
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
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 transition-all active:scale-95"
                                            >
                                                {isSavingHousehold ? "Saving..." : "Update Household"}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}
                        </>
                    ) : (
                        <>
                            {/* Security Settings Section */}
                            <Card className="border-base-200/50 shadow-sm overflow-hidden group">
                                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                <CardHeader>
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-rose-100 text-rose-600 rounded-lg">
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
                                        <div className="flex items-center gap-2 text-sm font-semibold text-base-900">
                                            <Mail className="h-4 w-4" />
                                            Email Address
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2 items-end">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-base-500 uppercase tracking-wider">New Email Address</label>
                                                <Input 
                                                    type="email"
                                                    value={newEmail} 
                                                    onChange={(e) => setNewEmail(e.target.value)} 
                                                    className="bg-base-50/50 border-base-200 focus:bg-white transition-all"
                                                />
                                            </div>
                                            <div className="text-xs text-base-500 pb-2 italic">
                                                Note: Changing your email will require you to log in again with the new credentials.
                                            </div>
                                        </div>
                                    </div>

                                    <div className="h-px bg-base-100" />

                                    {/* Password Section */}
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-base-900">
                                            <Lock className="h-4 w-4" />
                                            Update Password
                                        </div>
                                        <div className="grid gap-6 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-base-500 uppercase tracking-wider">New Password</label>
                                                <Input 
                                                    type="password"
                                                    value={newPassword} 
                                                    onChange={(e) => setNewPassword(e.target.value)} 
                                                    placeholder="Minimum 8 characters"
                                                    className="bg-base-50/50 border-base-200 focus:bg-white transition-all"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-base-500 uppercase tracking-wider">Confirm New Password</label>
                                                <Input 
                                                    type="password"
                                                    value={confirmPassword} 
                                                    onChange={(e) => setConfirmPassword(e.target.value)} 
                                                    className="bg-base-50/50 border-base-200 focus:bg-white transition-all"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex justify-end pt-4">
                                        <Button 
                                            onClick={handleUpdateSecurity} 
                                            disabled={isSavingUser || (newEmail === user.email && !newPassword)}
                                            className="bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-200 transition-all active:scale-95"
                                        >
                                            {isSavingUser ? "Updating..." : "Update Security Settings"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Additional Security Info */}
                            <Card className="border-base-200/50 bg-base-50/30">
                                <CardContent className="p-6 flex items-start gap-4">
                                    <div className="p-2 bg-white border border-base-200 rounded-lg shadow-sm">
                                        <Shield className="h-5 w-5 text-primary-500" />
                                    </div>
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-semibold text-base-900">Security Recommendation</h4>
                                        <p className="text-xs text-base-500 leading-relaxed">
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
