import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { Badge } from "../../components/ui/Badge"
import { StatCard } from "../../components/ui/StatCard"
import { UserCircle, Trash2, MailPlus, Plus, ChevronRight, Home, Shield, ShieldAlert, User, Settings, Clock } from "lucide-react"
import { useLoaderData, useSearchParams, useRevalidator } from "react-router"
import type { HouseholdMemberUserResponse, HouseholdRoleType, HouseholdResponse, HouseholdInviteResponse, HouseholdSplitShareResponse, SplitMode, BalanceResponse } from "../../types/types"
import { useHousehold } from "../../lib/HouseholdContext"
import { useAuth } from "../../lib/AuthContext"
import api from "../../lib/api"
import type { HouseholdsLoaderData } from "./households.loader"
export { householdsLoader as loader } from "./households.loader";

export default function Households() {
    const { households, activeHousehold, setActiveHousehold, refreshHouseholds } = useHousehold();
    const { user: currentUser } = useAuth();
    const revalidator = useRevalidator();
    const { currencies = [], countries = [], accounts = [], balances = [] } = useLoaderData() as HouseholdsLoaderData;
    const [members, setMembers] = useState<HouseholdMemberUserResponse[]>([])
    const [invites, setInvites] = useState<HouseholdInviteResponse[]>([])
    const [splitShares, setSplitShares] = useState<HouseholdSplitShareResponse[]>([])
    const [splitMode, setSplitMode] = useState<SplitMode>("even")
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [inviteEmail, setInviteEmail] = useState("")
    const [createForm, setCreateForm] = useState({
        name: "",
        base_currency: "USD",
        country_code: "US"
    })
    const [editForm, setEditForm] = useState<Partial<HouseholdResponse>>({})
    const [isLoadingMembers, setIsLoadingMembers] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchParams] = useSearchParams()
    const isSetupMode = searchParams.get("setup") === "true"

    const [pendingRoleUpdate, setPendingRoleUpdate] = useState<{ memberId: string, newRole: HouseholdRoleType } | null>(null)

    useEffect(() => {
        if (activeHousehold) {
            fetchMembers(activeHousehold.id);
            fetchInvites(activeHousehold.id);
            setSplitMode(activeHousehold.default_split_mode);
            api.get(`/users/households/${activeHousehold.id}/split-shares`).then(r => setSplitShares(r.data)).catch(() => setSplitShares([]));
            setPendingRoleUpdate(null);
            setEditForm({
                name: activeHousehold.name,
                base_currency: activeHousehold.base_currency,
                country_code: activeHousehold.country_code
            });
        }
    }, [activeHousehold]);

    const fetchMembers = async (householdId: string) => {
        setIsLoadingMembers(true);
        try {
            const response = await api.get(`/users/householdmember/${householdId}`);
            setMembers(response.data);
        } catch (error) {
            console.error("Failed to fetch members", error);
        } finally {
            setIsLoadingMembers(false);
        }
    };

    const fetchInvites = async (householdId: string) => {
        try {
            const response = await api.get(`/users/households/${householdId}/invites`);
            setInvites(response.data);
        } catch (error) {
            console.error("Failed to fetch invites", error);
        }
    };

    const handleResendInvite = async (inviteId: string) => {
        try {
            await api.post(`/users/invites/${inviteId}/resend`);
            if (activeHousehold) fetchInvites(activeHousehold.id);
        } catch (err) {
            console.error("Failed to resend invite", err);
        }
    };

    const handleCancelInvite = async (inviteId: string) => {
        try {
            await api.delete(`/users/invites/${inviteId}`);
            setInvites(invites.filter(i => i.id !== inviteId));
        } catch (err) {
            console.error("Failed to cancel invite", err);
        }
    };

    const handleSetSplitMode = async (mode: SplitMode) => {
        if (!activeHousehold) return;
        setSplitMode(mode);
        try {
            await api.put(`/users/households/${activeHousehold.id}`, { default_split_mode: mode });
            if (mode === "even" && members.length > 0) {
                const evenPercent = (100 / members.length).toFixed(2);
                const shares = members.map(m => ({ user_id: m.user_id, share_percent: evenPercent }));
                const res = await api.put(`/users/households/${activeHousehold.id}/split-shares`, shares);
                setSplitShares(res.data);
            }
        } catch (err) {
            console.error("Failed to update split mode", err);
        }
    };

    const handleToggleAccountShared = async (accountId: string, currentlyPrivate: boolean) => {
        try {
            await api.put(`/accounts/${accountId}`, { owner_user_id: currentlyPrivate ? null : currentUser?.id });
            revalidator.revalidate();
        } catch (err) {
            console.error("Failed to update account sharing", err);
        }
    };

    const sharedAccountsCount = accounts.filter(a => !a.owner_user_id).length;

    const sharedNetWorth = (() => {
        const latestByAccount = new Map<string, BalanceResponse>();
        balances.forEach(b => {
            const existing = latestByAccount.get(b.account_id);
            if (!existing || b.date > existing.date) latestByAccount.set(b.account_id, b);
        });
        return accounts
            .filter(a => !a.owner_user_id)
            .reduce((sum, a) => {
                const bal = latestByAccount.get(a.id);
                return sum + Number(bal?.balance_home_currency ?? bal?.balance ?? 0);
            }, 0);
    })();

    const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: activeHousehold?.base_currency || 'USD',
        maximumFractionDigits: 0,
    }).format(value);

    const handleUpdateRole = async (memberId: string, currentRole: string) => {
        if (currentRole === 'owner') return;

        const newRole: HouseholdRoleType = currentRole === 'viewer' ? 'editor' : 'viewer';

        if (pendingRoleUpdate?.memberId === memberId && pendingRoleUpdate?.newRole === newRole) {
            // Second click: Confirm
            try {
                await api.put(`/users/householdmember/${memberId}`, { role: newRole });
                setMembers(members.map(m => m.id === memberId ? { ...m, role: newRole } : m));
                setPendingRoleUpdate(null);
            } catch (err) {
                console.error("Failed to update role", err);
            }
        } else {
            // First click: Prepare
            setPendingRoleUpdate({ memberId, newRole });
        }
    }

    const handleUpdateHousehold = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeHousehold || !editForm.name) return;

        try {
            await api.put(`/users/households/${activeHousehold.id}`, editForm);
            setIsEditModalOpen(false);
            refreshHouseholds();
        } catch (err) {
            console.error("Failed to update household", err);
        }
    };

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null);
        if (!inviteEmail || !activeHousehold) return;

        try {
            // Invites work whether or not the person already has an account - if they do, they're
            // joined immediately; otherwise the invite stays pending until they sign up with that email.
            await api.post(`/users/households/${activeHousehold.id}/invites`, {
                email: inviteEmail,
                role: "editor"
            });

            setInviteEmail("")
            setIsInviteModalOpen(false)
            fetchMembers(activeHousehold.id);
            fetchInvites(activeHousehold.id);
        } catch (err: any) {
            setError(err.response?.data?.detail || "Failed to send invite.");
        }
    }

    const handleCreateHousehold = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!createForm.name) return;

        try {
            await api.post('/users/households', createForm);
            setCreateForm({
                name: "",
                base_currency: "USD",
                country_code: "US"
            });
            setIsCreateModalOpen(false);
            refreshHouseholds();
        } catch (err) {
            console.error("Failed to create household", err);
        }
    };

    const handleRemoveMember = async (memberId: string) => {
        if (!confirm("Are you sure you want to remove this member?")) return;
        try {
            await api.delete(`/users/householdmember/${memberId}`);
            setMembers(members.filter(m => m.id !== memberId));
        } catch (err) {
            console.error("Failed to remove member", err);
        }
    }

    return (
        <div className="flex-1 space-y-6 p-8 relative">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900 dark:text-base-50">Household Management</h2>
                    <p className="text-base-500 dark:text-base-400 mt-1">Switch between households and manage members.</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setIsCreateModalOpen(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        New Household
                    </Button>
                    <Button variant="primary" onClick={() => setIsInviteModalOpen(true)} disabled={!activeHousehold}>
                        <MailPlus className="w-4 h-4 mr-2" />
                        Invite Member
                    </Button>
                </div>
            </div>

            {isSetupMode && households.length === 0 && (
                <Card className="bg-primary-50 dark:bg-primary-950/30 border-primary-200 dark:border-primary-800 border-2 shadow-lg animate-in fade-in slide-in-from-top-4 duration-500">
                    <CardContent className="pt-6 pb-6 flex flex-col md:flex-row items-center gap-6">
                        <div className="p-4 bg-primary-100 dark:bg-primary-900/50 rounded-2xl text-primary-600 dark:text-primary-400">
                            <Home className="w-12 h-12" />
                        </div>
                        <div className="flex-1 text-center md:text-left">
                            <h3 className="text-2xl font-bold text-primary-900 dark:text-primary-50 mb-2">Welcome to Finance Tracker!</h3>
                            <p className="text-primary-700 dark:text-primary-300 max-w-2xl">
                                To get started, you'll need to create your first household. A household is where you manage your accounts, transactions, and portfolios together with your family or for yourself.
                            </p>
                        </div>
                        <Button
                            variant="primary"
                            size="lg"
                            className="whitespace-nowrap shadow-md hover:shadow-lg transition-all"
                            onClick={() => setIsCreateModalOpen(true)}
                        >
                            <Plus className="w-5 h-5 mr-2" />
                            Create My First Household
                        </Button>
                    </CardContent>
                </Card>
            )}

            {activeHousehold && (
                <div className="grid gap-4 md:grid-cols-4">
                    <StatCard title="Shared net worth" value={formatCurrency(sharedNetWorth)} trend="neutral" />
                    <StatCard title="Members" value={String(members.length)} description={invites.length > 0 ? `+ ${invites.length} invited` : undefined} trend="neutral" />
                    <StatCard title="Shared accounts" value={`${sharedAccountsCount}`} description={`of ${accounts.length}`} trend="neutral" />
                    <StatCard title="Base currency" value={activeHousehold.base_currency} trend="neutral" />
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Household Selector */}
                <div className="lg:col-span-1 space-y-4">
                    <h3 className="text-lg font-semibold text-base-900">Your Households</h3>
                    <div className="grid gap-2">
                        {households.map((h) => (
                            <button
                                key={h.id}
                                onClick={() => setActiveHousehold(h)}
                                className={`flex items-center justify-between p-4 rounded-xl border transition-all text-left ${activeHousehold?.id === h.id
                                    ? "border-primary-500 bg-primary-50/50 dark:bg-primary-900/20 shadow-sm"
                                    : "border-base-200 dark:border-base-800 bg-white dark:bg-base-900 hover:border-base-300 dark:hover:border-base-700 hover:bg-base-50 dark:hover:bg-base-800"
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${activeHousehold?.id === h.id ? "bg-primary-100 dark:bg-primary-900/50 text-primary-600 dark:text-primary-400" : "bg-base-100 dark:bg-base-800 text-base-500 dark:text-base-400"}`}>
                                        <Home className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className={`font-medium ${activeHousehold?.id === h.id ? "text-primary-900 dark:text-primary-50" : "text-base-900 dark:text-base-50"}`}>{h.name}</p>
                                        <p className="text-xs text-base-500 dark:text-base-400">{h.base_currency} • {h.country_code}</p>
                                    </div>
                                </div>
                                {activeHousehold?.id === h.id && <ChevronRight className="w-5 h-5 text-primary-500" />}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Member List */}
                <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-base-900 dark:text-base-50">
                            Members of {activeHousehold?.name || "..."}
                        </h3>
                        {activeHousehold && (
                            <Button variant="ghost" size="sm" onClick={() => setIsEditModalOpen(true)} className="text-base-500 hover:text-base-900">
                                <Settings className="w-4 h-4 mr-2" />
                                Household Settings
                            </Button>
                        )}
                    </div>
                    {isLoadingMembers ? (
                        <div className="p-8 text-center text-base-500">Loading members...</div>
                    ) : (
                        <div className="grid gap-4">
                            {members.map((member) => (
                                <Card key={member.id}>
                                    <CardHeader className="flex flex-row items-center justify-between py-4">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-100 dark:bg-base-800 text-base-500 dark:text-base-400">
                                                <UserCircle className="h-6 h-6" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base font-semibold">{member.name}</CardTitle>
                                                <div className="flex items-center gap-2">
                                                    <CardDescription className="text-xs">{member.email}</CardDescription>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleUpdateRole(member.id, member.role);
                                                        }}
                                                        onMouseLeave={() => {
                                                            if (pendingRoleUpdate?.memberId === member.id) {
                                                                setPendingRoleUpdate(null);
                                                            }
                                                        }}
                                                        disabled={member.role === 'owner'}
                                                        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full transition-all ${member.role === 'owner'
                                                            ? 'bg-secondary-100 dark:bg-secondary-900/50 text-secondary-700 dark:text-secondary-400 cursor-default'
                                                            : pendingRoleUpdate?.memberId === member.id
                                                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ring-2 ring-amber-500 scale-105 cursor-pointer animate-pulse'
                                                                : 'bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-800 cursor-pointer'
                                                            }`}
                                                        title={member.role === 'owner'
                                                            ? "Owner role cannot be changed"
                                                            : pendingRoleUpdate?.memberId === member.id
                                                                ? "Click again to confirm"
                                                                : `Click to change to ${member.role === 'viewer' ? 'editor' : 'viewer'}`
                                                        }
                                                    >
                                                        {pendingRoleUpdate?.memberId === member.id ? (
                                                            <>Confirm {pendingRoleUpdate.newRole}?</>
                                                        ) : (
                                                            <>
                                                                {member.role === 'owner' && <ShieldAlert className="w-3 h-3" />}
                                                                {member.role === 'editor' && <Shield className="w-3 h-3 text-amber-500" />}
                                                                {member.role === 'viewer' && <User className="w-3 h-3 text-base-400" />}
                                                                {member.role}
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                        {member.role !== 'owner' && (
                                            <Button variant="ghost" onClick={() => handleRemoveMember(member.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 h-auto">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </CardHeader>
                                </Card>
                            ))}
                            {members.length === 0 && activeHousehold && (
                                <p className="text-sm text-base-500 dark:text-base-400 italic py-8 text-center bg-base-50/50 dark:bg-base-900/50 rounded-xl border border-dashed border-base-200 dark:border-base-800">
                                    No members found for this household.
                                </p>
                            )}
                            {invites.map((invite) => (
                                <Card key={invite.id} className="border-dashed border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/10">
                                    <CardHeader className="flex flex-row items-center justify-between py-4">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-amber-300 dark:border-amber-800 text-amber-500">
                                                <Clock className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <CardTitle className="text-base font-semibold">{invite.email}</CardTitle>
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="warning">PENDING</Badge>
                                                    <CardDescription className="text-xs">
                                                        Invited {new Date(invite.created_at).toLocaleDateString('default', { month: 'short', day: 'numeric' })}
                                                    </CardDescription>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => handleResendInvite(invite.id)}>Resend</Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleCancelInvite(invite.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardHeader>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {activeHousehold && members.length > 1 && (
                <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Default expense split</CardTitle>
                            <CardDescription>Applied to new shared expenses. Override per transaction anytime.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {splitShares.length > 0 && (
                                <div className="space-y-2">
                                    {splitShares.map(s => {
                                        const member = members.find(m => m.user_id === s.user_id);
                                        return (
                                            <div key={s.id} className="flex items-center gap-3">
                                                <span className="text-sm text-base-700 dark:text-base-300 w-24 truncate">{member?.name || "Member"}</span>
                                                <div className="flex-1 h-2 rounded-full bg-base-100 dark:bg-base-800 overflow-hidden">
                                                    <div className="h-full bg-primary-500" style={{ width: `${s.share_percent}%` }} />
                                                </div>
                                                <span className="text-xs font-mono text-base-500 w-10 text-right">{Number(s.share_percent).toFixed(0)}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <div className="flex gap-2 pt-2">
                                {(["even", "by_income", "custom"] as SplitMode[]).map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => handleSetSplitMode(mode)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${splitMode === mode
                                            ? "bg-primary-500 text-white border-primary-500"
                                            : "border-base-200 dark:border-base-800 text-base-600 dark:text-base-400 hover:border-base-300"
                                            }`}
                                    >
                                        {mode === "even" ? "50 / 50" : mode === "by_income" ? "By income" : "Custom"}
                                    </button>
                                ))}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>What's shared with the household</CardTitle>
                            <CardDescription>Toggle any account between private and shared.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {accounts.map(a => {
                                    const isPrivate = !!a.owner_user_id;
                                    const isMine = a.owner_user_id === currentUser?.id;
                                    return (
                                        <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-base-100 dark:border-base-800 px-3 py-2.5">
                                            <span className="text-sm text-base-800 dark:text-base-200 truncate">
                                                {isPrivate && "🔒 "}{a.name}
                                            </span>
                                            <button
                                                role="switch"
                                                aria-checked={!isPrivate}
                                                disabled={isPrivate && !isMine}
                                                onClick={() => handleToggleAccountShared(a.id, isPrivate)}
                                                title={isPrivate && !isMine ? "Only the owner can share this account" : undefined}
                                                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${!isPrivate ? "bg-primary-500" : "bg-base-300 dark:bg-base-700"}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${!isPrivate ? "translate-x-4" : ""}`} />
                                            </button>
                                        </div>
                                    );
                                })}
                                {accounts.length === 0 && (
                                    <div className="col-span-full text-center py-4 text-base-500 italic text-sm">No accounts yet.</div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Invite Modal */}
            {isInviteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-sm bg-white shadow-xl">
                        <CardHeader>
                            <CardTitle>Invite Member</CardTitle>
                            <CardDescription>Enter the email of an existing user to invite them to {activeHousehold?.name}.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleInvite} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Email Address</label>
                                    <Input
                                        type="email"
                                        placeholder="user@example.com"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        required
                                    />
                                    {error && <p className="text-xs text-red-500">{error}</p>}
                                </div>
                                <div className="flex gap-3 justify-end pt-4">
                                    <Button variant="ghost" type="button" onClick={() => setIsInviteModalOpen(false)}>Cancel</Button>
                                    <Button variant="primary" type="submit">Send Invite</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Create Household Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-sm bg-white shadow-xl">
                        <CardHeader>
                            <CardTitle>Create New Household</CardTitle>
                            <CardDescription>Give your new household a name (e.g., "Family Fund", "Personal").</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleCreateHousehold} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Household Name</label>
                                    <Input
                                        placeholder="e.g. My Family"
                                        value={createForm.name}
                                        onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Base Currency</label>
                                    <select
                                        className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                        value={createForm.base_currency}
                                        onChange={(e) => setCreateForm({ ...createForm, base_currency: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Currency</option>
                                        {currencies.map(c => (
                                            <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Country</label>
                                    <select
                                        className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                        value={createForm.country_code}
                                        onChange={(e) => setCreateForm({ ...createForm, country_code: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Country</option>
                                        {countries.map(c => (
                                            <option key={c.code} value={c.code}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-3 justify-end pt-4">
                                    <Button variant="ghost" type="button" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
                                    <Button variant="primary" type="submit">Create</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Edit Household Modal */}
            {isEditModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-sm bg-white shadow-xl">
                        <CardHeader>
                            <CardTitle>Household Settings</CardTitle>
                            <CardDescription>Update your household details.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleUpdateHousehold} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Household Name</label>
                                    <Input
                                        placeholder="e.g. My Family"
                                        value={editForm.name || ""}
                                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Base Currency</label>
                                    <select
                                        className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                        value={editForm.base_currency || ""}
                                        onChange={(e) => setEditForm({ ...editForm, base_currency: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Currency</option>
                                        {currencies.map(c => (
                                            <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900 dark:text-base-50">Country</label>
                                    <select
                                        className="w-full rounded-md border border-base-200 dark:border-base-800 bg-white dark:bg-base-900 px-3 py-2 text-sm text-base-900 dark:text-base-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                                        value={editForm.country_code || ""}
                                        onChange={(e) => setEditForm({ ...editForm, country_code: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Country</option>
                                        {countries.map(c => (
                                            <option key={c.code} value={c.code}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-3 justify-end pt-4">
                                    <Button variant="ghost" type="button" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
                                    <Button variant="primary" type="submit">Save Changes</Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}