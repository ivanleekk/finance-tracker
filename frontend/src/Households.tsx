import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/Card"
import { Button } from "./components/ui/Button"
import { Input } from "./components/ui/Input"
import { UserCircle, Trash2, MailPlus } from "lucide-react"

type Subportfolio = {
    id: string;
    name: string;
    equity: number;
    unrealized: number;
}

type HouseholdMember = {
    id: string;
    name: string;
    email: string;
    role: "owner" | "member";
    subportfolios: Subportfolio[];
}

export default function Households() {
    const [members, setMembers] = useState<HouseholdMember[]>([
        {
            id: "m-1",
            name: "Ivan Lee",
            email: "ivan@example.com",
            role: "owner",
            subportfolios: [
                { id: "sp-1", name: "Retirement", equity: 96000, unrealized: 18000 },
                { id: "sp-2", name: "Trading", equity: 29450, unrealized: 4120 }
            ]
        },
        {
            id: "m-2",
            name: "Jane Doe",
            email: "jane@example.com",
            role: "member",
            subportfolios: [
                { id: "sp-3", name: "Joint Savings", equity: 45000, unrealized: 1200 },
                { id: "sp-4", name: "Tech Stocks", equity: 15200, unrealized: 3400 }
            ]
        }
    ])

    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [inviteEmail, setInviteEmail] = useState("")

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
    }

    const handleInvite = (e: React.FormEvent) => {
        e.preventDefault()
        if (!inviteEmail) return;
        
        const newMember: HouseholdMember = {
            id: `m-${Date.now()}`,
            name: inviteEmail.split('@')[0], // Mock name from email
            email: inviteEmail,
            role: "member",
            subportfolios: []
        }
        
        setMembers([...members, newMember])
        setInviteEmail("")
        setIsInviteModalOpen(false)
    }

    const handleRemoveMember = (id: string) => {
        setMembers(members.filter(m => m.id !== id))
    }

    return (
        <div className="flex-1 space-y-6 p-8 relative">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-base-900">Household Management</h2>
                    <p className="text-base-500 mt-1">Manage members and view family subportfolios.</p>
                </div>
                <Button variant="primary" onClick={() => setIsInviteModalOpen(true)}>
                    <MailPlus className="w-4 h-4 mr-2" />
                    Invite Member
                </Button>
            </div>

            <div className="grid gap-6">
                {members.map((member) => (
                    <Card key={member.id}>
                        <CardHeader className="flex flex-row items-center justify-between border-b border-base-100 pb-4">
                            <div className="flex items-center gap-4">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-base-100 text-base-500">
                                    <UserCircle className="h-8 w-8" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">{member.name}</CardTitle>
                                    <div className="flex items-center gap-2 mt-1">
                                        <CardDescription>{member.email}</CardDescription>
                                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${member.role === 'owner' ? 'bg-primary-100 text-primary-700' : 'bg-base-100 text-base-600'}`}>
                                            {member.role === 'owner' ? 'Owner' : 'Member'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {member.role !== 'owner' && (
                                <Button variant="ghost" onClick={() => handleRemoveMember(member.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                                    <Trash2 className="w-5 h-5" />
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="pt-4">
                            {member.subportfolios.length > 0 ? (
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {member.subportfolios.map(sp => (
                                        <div key={sp.id} className="p-4 rounded-xl border border-base-200 bg-base-50/50 hover:bg-white hover:shadow-sm transition-all">
                                            <h4 className="font-semibold text-base-900">{sp.name}</h4>
                                            <div className="mt-2 flex justify-between items-end">
                                                <div>
                                                    <p className="text-xs text-base-500 mb-1">Total Equity</p>
                                                    <p className="font-medium text-base-900">{formatCurrency(sp.equity)}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-xs text-base-500 mb-1">Unrealized P&L</p>
                                                    <p className={`font-medium ${sp.unrealized >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                        {sp.unrealized >= 0 ? '+' : ''}{formatCurrency(sp.unrealized)}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-base-500 italic py-4 text-center">This member has not created any subportfolios yet.</p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Invite Modal */}
            {isInviteModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-sm bg-white shadow-xl">
                        <CardHeader>
                            <CardTitle>Invite Household Member</CardTitle>
                            <CardDescription>Enter the email address of the person you want to invite.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleInvite} className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-base-900">Email Address</label>
                                    <Input 
                                        type="email" 
                                        placeholder="jane@example.com" 
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                        required
                                    />
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
        </div>
    )
}
