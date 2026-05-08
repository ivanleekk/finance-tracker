import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../components/ui/Card"
import { Button } from "../../components/ui/Button"
import { Input } from "../../components/ui/Input"
import { UserCircle, Trash2, MailPlus, Plus, ChevronRight, Home, Shield, ShieldAlert, User, Settings } from "lucide-react"
import { useLoaderData, useSearchParams } from "react-router"
import type { HouseholdMemberUserResponse, HouseholdRoleType, HouseholdResponse, CurrencyResponse, CountryResponse } from "../../types/types"
import { useHousehold } from "../../lib/HouseholdContext"
import api from "../../lib/api"
import type { HouseholdsLoaderData } from "./households.loader"
export { householdsLoader as loader } from "./households.loader";

export default function Households() {
    const { households, activeHousehold, setActiveHousehold, refreshHouseholds } = useHousehold();
    const { currencies = [], countries = [] } = useLoaderData() as HouseholdsLoaderData;
    const [members, setMembers] = useState<HouseholdMemberUserResponse[]>([])
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [inviteEmail, setInviteEmail] = useState("")
    const [newHouseholdName, setNewHouseholdName] = useState("")
    const [editForm, setEditForm] = useState<Partial<HouseholdResponse>>({})
    const [isLoadingMembers, setIsLoadingMembers] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [searchParams] = useSearchParams()
    const isSetupMode = searchParams.get("setup") === "true"

    const [pendingRoleUpdate, setPendingRoleUpdate] = useState<{ memberId: string, newRole: HouseholdRoleType } | null>(null)

    useEffect(() => {
        if (activeHousehold) {
            fetchMembers(activeHousehold.id);
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
            // 1. Search for user by email
            const userRes = await api.get(`/users/search?email=${inviteEmail}`);
            const user = userRes.data;

            // 2. Add as member
            await api.post('/users/householdmembers', {
                household_id: activeHousehold.id,
                user_id: user.id,
                role: "viewer"
            });

            setInviteEmail("")
            setIsInviteModalOpen(false)
            fetchMembers(activeHousehold.id);
        } catch (err: any) {
            setError(err.response?.data?.detail || "Failed to invite member. Make sure the user exists.");
        }
    }

    const handleCreateHousehold = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newHouseholdName) return;

        try {
            await api.post('/users/households', {
                name: newHouseholdName,
                base_currency: "USD", // Default
                country_code: "US"    // Default
            });
            setNewHouseholdName("");
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
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Household Management</h2>
                    <p className="text-base-500 mt-1">Switch between households and manage members.</p>
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
                <Card className="bg-primary-50 border-primary-200 border-2 shadow-lg animate-in fade-in slide-in-from-top-4 duration-500">
                    <CardContent className="pt-6 pb-6 flex flex-col md:flex-row items-center gap-6">
                        <div className="p-4 bg-primary-100 rounded-2xl text-primary-600">
                            <Home className="w-12 h-12" />
                        </div>
                        <div className="flex-1 text-center md:text-left">
                            <h3 className="text-2xl font-bold text-primary-900 mb-2">Welcome to Finance Tracker!</h3>
                            <p className="text-primary-700 max-w-2xl">
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
                                    ? "border-primary-500 bg-primary-50/50 shadow-sm"
                                    : "border-base-200 bg-white hover:border-base-300 hover:bg-base-50"
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${activeHousehold?.id === h.id ? "bg-primary-100 text-primary-600" : "bg-base-100 text-base-500"}`}>
                                        <Home className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className={`font-medium ${activeHousehold?.id === h.id ? "text-primary-900" : "text-base-900"}`}>{h.name}</p>
                                        <p className="text-xs text-base-500">{h.base_currency} • {h.country_code}</p>
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
                        <h3 className="text-lg font-semibold text-base-900">
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
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-100 text-base-500">
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
                                                            ? 'bg-primary-100 text-primary-700 cursor-default'
                                                            : pendingRoleUpdate?.memberId === member.id
                                                                ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-500 scale-105 cursor-pointer animate-pulse'
                                                                : 'bg-base-100 text-base-600 hover:bg-base-200 cursor-pointer'
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
                                <p className="text-sm text-base-500 italic py-8 text-center bg-base-50/50 rounded-xl border border-dashed border-base-200">
                                    No members found for this household.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

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
                                    <label className="text-sm font-medium text-base-900">Email Address</label>
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
                                    <label className="text-sm font-medium text-base-900">Household Name</label>
                                    <Input
                                        placeholder="e.g. My Family"
                                        value={newHouseholdName}
                                        onChange={(e) => setNewHouseholdName(e.target.value)}
                                        required
                                    />
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
                                    <label className="text-sm font-medium text-base-900">Household Name</label>
                                    <Input
                                        placeholder="e.g. My Family"
                                        value={editForm.name || ""}
                                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Base Currency</label>
                                    <select
                                        className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                                    <label className="text-sm font-medium text-base-900">Country</label>
                                    <select
                                        className="w-full rounded-md border border-base-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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