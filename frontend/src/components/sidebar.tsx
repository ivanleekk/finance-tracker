import { Link } from "react-router"
import { LayoutDashboard, ArrowRightLeft, PieChart, History, Settings, UserCircle, Wallet, Landmark, Users } from "lucide-react"
import SidebarButton from "./sidebarButton"

function Sidebar() {
    return (
        <div className="flex h-screen w-64 flex-col border-r border-base-200 bg-white">
            <div className="flex h-16 items-center px-6 border-b border-base-100">
                <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight text-primary-600">
                    <Wallet className="h-6 w-6" />
                    FinTracker
                </Link>
            </div>
            
            <div className="flex flex-1 flex-col justify-between overflow-y-auto px-4 py-6">
                <div className="flex flex-col gap-1">
                    <SidebarButton text="Dashboard" href="/dashboard" icon={<LayoutDashboard />} />
                    <SidebarButton text="Accounts" href="/accounts" icon={<Landmark />} />
                    <SidebarButton text="Households" href="/households" icon={<Users />} />
                    <SidebarButton text="Trade" href="/trade" icon={<ArrowRightLeft />} />
                    <SidebarButton text="Portfolio" href="/portfolio" icon={<PieChart />} />
                    <SidebarButton text="History" href="/history" icon={<History />} />
                </div>
                
                <div className="flex flex-col gap-1">
                    <SidebarButton text="Settings" href="/settings" icon={<Settings />} />
                    <SidebarButton text="Profile" href="/profile" icon={<UserCircle />} />
                </div>
            </div>
        </div>
    )
}

export default Sidebar