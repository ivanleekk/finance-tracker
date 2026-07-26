import { useNavigate, Link } from "react-router"
import { Button } from "./components/ui/Button"
import { BrandMark } from "./components/BrandMark"
import {
    ArrowRight,
    Globe,
    Home,
    LifeBuoy,
    Users,
    Target,
    TrendingUp,
    ShieldCheck,
    LineChart,
    ChevronRight,
    Table2
} from "lucide-react"
import { cn } from "./lib/utils"

export function meta() {
    const title = "Waypoint — Know where you stand, and when you get there"
    const description =
        "Bring your accounts, investments, property and loans into one number, then see when the deposit lands, when the debt clears, and how long your savings would last."

    return [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
    ]
}

export default function LandingPage() {
    const navigate = useNavigate()

    const features = [
        {
            title: "Goals with a real date",
            description: "Name what you're saving for and when you need it. Waypoint tracks your pace, projects the date you'll actually get there, and tells you the monthly number that lands it on time.",
            icon: <Target className="h-6 w-6" />,
            color: "text-blue-600",
            bg: "bg-blue-50"
        },
        {
            title: "A runway you can trust",
            description: "Budgets and recurring bills roll into an honest burn rate and an emergency fund measured in months covered. Investing is excluded from the maths, so the number isn't flattering you.",
            icon: <LifeBuoy className="h-6 w-6" />,
            color: "text-emerald-600",
            bg: "bg-emerald-50"
        },
        {
            title: "Property and the loan that bought it",
            description: "Record the house next to its mortgage. Waypoint amortizes every payment down to the last cent, then tells you your debt-free date and the month your net worth turns positive.",
            icon: <Home className="h-6 w-6" />,
            color: "text-amber-600",
            bg: "bg-amber-50"
        },
        {
            title: "Money you share, money you don't",
            description: "Invite a partner for one household picture. Private accounts stay private — on every screen, every report, and every export.",
            icon: <Users className="h-6 w-6" />,
            color: "text-purple-600",
            bg: "bg-purple-50"
        },
        {
            title: "One currency, whatever you hold",
            description: "Assets in any currency, converted at the rates that actually applied on the day. Your net worth reads as one number instead of four.",
            icon: <Globe className="h-6 w-6" />,
            color: "text-sky-600",
            bg: "bg-sky-50"
        },
        {
            title: "Returns you can actually judge",
            description: "TWR, IRR, Sharpe and Sortino computed from your real trades — plus dividends tracked and credited to the right portfolio as they land.",
            icon: <TrendingUp className="h-6 w-6" />,
            color: "text-rose-600",
            bg: "bg-rose-50"
        }
    ];

    return (
        <div className="min-h-screen bg-base-50 dark:bg-base-950 selection:bg-primary-100 selection:text-primary-900 transition-colors duration-300">
            {/* Navigation Header */}
            {/* <nav className="fixed top-0 z-50 w-full border-b border-base-200/50 bg-white/70 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
                    <Link to="/" className="flex items-center gap-2 text-2xl font-bold tracking-tight text-primary-600">
                        <BrandMark className="h-8 w-8" />
                        Waypoint
                    </Link>
                    <div className="flex items-center gap-6">
                        <Link to="/login" className="text-sm font-medium text-base-600 hover:text-base-900 transition-colors">Log In</Link>
                        <Button size="sm" onClick={() => navigate('/signup')} className="bg-primary-600 hover:bg-primary-700 shadow-md shadow-primary-200">
                            Get Started
                        </Button>
                    </div>
                </div>
            </nav> */}

            {/* Hero Section */}
            <section className="relative overflow-hidden pt-32 pb-20 lg:pt-48 lg:pb-32">
                <div className="absolute top-0 -z-10 h-full w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary-100/40 via-base-50 dark:via-base-950 to-transparent" />
                <div className="absolute bottom-0 -z-10 h-1/2 w-full bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-indigo-50/30 via-base-50 dark:via-base-950 to-transparent" />

                <div className="mx-auto max-w-7xl px-6">
                    <div className="flex flex-col items-center text-center">
                        <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700 ring-1 ring-inset ring-primary-600/20 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <Target className="h-3 w-3" />
                            <span>Every goal gets a date</span>
                            <ChevronRight className="h-3 w-3" />
                        </div>
                        <h1 className="text-5xl font-extrabold tracking-tight text-base-900 dark:text-base-50 sm:text-7xl mb-8 max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700">
                            Know where you stand — <span className="bg-gradient-to-r from-primary-600 to-indigo-600 bg-clip-text text-transparent">and when you get there.</span>
                        </h1>
                        <p className="text-xl text-base-500 max-w-2xl mb-12 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                            Waypoint brings your accounts, investments, property and loans into one number — then projects it forward, so you know when the deposit lands, when the debt clears, and how long your savings would really last.
                        </p>
                        <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-12 duration-1000">
                            <Button size="lg" onClick={() => navigate('/signup')} className="h-14 px-8 text-lg bg-primary-600 hover:bg-primary-700 shadow-xl shadow-primary-200 group">
                                Create your account
                                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                            </Button>
                            <p className="text-sm text-base-500">
                                Already have an account?{" "}
                                <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">
                                    Log in
                                </Link>
                            </p>
                        </div>

                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-24 bg-base-50/50 dark:bg-base-900/20">
                <div className="mx-auto max-w-7xl px-6">
                    <div className="mb-20 text-center">
                        <h2 className="text-sm font-semibold tracking-wide text-primary-600 dark:text-primary-400 uppercase mb-3">What you get</h2>
                        <h3 className="text-4xl font-bold text-base-900 dark:text-base-50">Answers, not just numbers</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
                        {features.map((feature, idx) => (
                            <Card key={idx} className="group border-none shadow-md hover:shadow-xl transition-all duration-300 bg-white/80 dark:bg-base-900/80 backdrop-blur-sm overflow-hidden">
                                <div className="p-8">
                                    <div className={cn("mb-6 flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110 duration-300", feature.bg, feature.color)}>
                                        {feature.icon}
                                    </div>
                                    <h4 className="text-xl font-bold text-base-900 dark:text-base-50 mb-3">{feature.title}</h4>
                                    <p className="text-base-500 leading-relaxed text-sm">
                                        {feature.description}
                                    </p>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            </section>

            {/* Visual Highlight Section */}
            <section className="py-24 overflow-hidden">
                <div className="mx-auto max-w-7xl px-6">
                    <div className="relative rounded-3xl bg-base-900 p-12 lg:p-24 overflow-hidden shadow-2xl">
                        <div className="absolute top-0 right-0 -mr-24 -mt-24 h-96 w-96 rounded-full bg-primary-500/20 blur-3xl" />
                        <div className="absolute bottom-0 left-0 -ml-24 -mb-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />

                        <div className="relative grid gap-12 lg:grid-cols-2 items-center">
                            <div className="space-y-8">
                                <div className="inline-flex items-center gap-2 rounded-lg bg-primary-500/10 px-3 py-1 text-sm font-medium text-primary-400">
                                    <Table2 className="h-4 w-4" />
                                    <span>What a spreadsheet can't do</span>
                                </div>
                                <h3 className="text-4xl font-bold text-white sm:text-5xl">Spreadsheets know today. <br />Waypoint knows when.</h3>
                                <p className="text-lg text-base-400">
                                    A sheet holds today's balances. It won't convert last March's purchase at last March's rate, amortize a mortgage to its final payment, or warn you that at your current pace the deposit lands eight months late. Waypoint keeps the history and does the arithmetic.
                                </p>
                                <ul className="space-y-4">
                                    {[
                                        "Historical FX applied at the date of every record",
                                        "Amortization schedules down to the final payment",
                                        "Dividends tracked and credited to the right portfolio",
                                        "Printable reports and a full CSV export, any time"
                                    ].map((item, idx) => (
                                        <li key={idx} className="flex items-center gap-3 text-white/80">
                                            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                                                <Check className="h-3 w-3" />
                                            </div>
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="relative h-[400px] rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm shadow-2xl lg:h-[500px]">
                                <div className="h-full w-full rounded-lg bg-gradient-to-br from-base-800 to-base-900 p-6">
                                    {/* Mock Dashboard UI element */}
                                    <div className="flex items-center justify-between mb-8">
                                        <div className="h-8 w-32 rounded bg-white/10 animate-pulse" />
                                        <div className="h-8 w-8 rounded-full bg-white/10 animate-pulse" />
                                    </div>
                                    <div className="space-y-4">
                                        <div className="h-32 w-full rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                                            <LineChart className="h-12 w-12 text-primary-400 opacity-50" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="h-24 rounded-xl bg-white/5 border border-white/10" />
                                            <div className="h-24 rounded-xl bg-white/5 border border-white/10" />
                                        </div>
                                        <div className="h-12 w-full rounded-xl bg-white/5 border border-white/10" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Footer */}
            <section className="py-24">
                <div className="mx-auto max-w-7xl px-6">
                    <div className="flex flex-col items-center text-center space-y-8">
                        <h2 className="text-4xl font-bold text-base-900 dark:text-base-50 sm:text-5xl">Start with one account and one goal.</h2>
                        <p className="text-lg text-base-500 max-w-xl">
                            That's enough for Waypoint to give you a net worth that's actually current and a date attached to the thing you're saving for. Everything else can come later.
                        </p>
                        <div className="flex gap-4">
                            <Button size="lg" onClick={() => navigate('/signup')} className="h-14 px-12 text-lg bg-primary-600 hover:bg-primary-700 shadow-xl shadow-primary-200">
                                Create your account
                            </Button>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-base-400 mt-4">
                            <ShieldCheck className="h-4 w-4 shrink-0" />
                            Private accounts stay private • Export everything as CSV, any time • Your data, your call
                        </div>
                    </div>
                </div>
            </section>

            <footer className="border-t border-base-200 dark:border-base-800 py-12">
                <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-2 text-xl font-bold text-base-900 dark:text-base-50">
                        <BrandMark className="h-6 w-6 text-primary-600" />
                        Waypoint
                    </div>
                    <p className="text-sm text-base-500">© 2026 Waypoint. All rights reserved.</p>
                    <div className="flex gap-6">
                        <a href="mailto:ivanleekaikiat@gmail.com" className="text-sm text-base-400 hover:text-base-600 dark:hover:text-base-300">Contact</a>
                    </div>
                </div>
            </footer>
        </div>
    )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("rounded-2xl bg-white dark:bg-base-900", className)}>
            {children}
        </div>
    )
}

function Check({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    )
}
