import { useNavigate, Link } from "react-router"
import { Button } from "./components/ui/Button"
import {
    Wallet,
    ArrowRight,
    Globe,
    Users,
    TrendingUp,
    ShieldCheck,
    Activity,
    LineChart,
    ChevronRight,
    Zap
} from "lucide-react"
import { cn } from "./lib/utils"

export default function LandingPage() {
    const navigate = useNavigate()

    const features = [
        {
            title: "Multi-Currency Tracking",
            description: "Track assets across any currency with automated historical exchange rate conversion to your reporting base currency.",
            icon: <Globe className="h-6 w-6" />,
            color: "text-blue-600",
            bg: "bg-blue-50"
        },
        {
            title: "Portfolio Performance",
            description: "Deep dive into your returns with TWR, MWR/IRR, and risk-adjusted ratios like Sharpe and Sortino.",
            icon: <TrendingUp className="h-6 w-6" />,
            color: "text-emerald-600",
            bg: "bg-emerald-50"
        },
        {
            title: "Household Management",
            description: "Collaborate with family members, manage shared accounts, and view consolidated net worth in one place.",
            icon: <Users className="h-6 w-6" />,
            color: "text-purple-600",
            bg: "bg-purple-50"
        },
        {
            title: "Advanced Trade Logging",
            description: "Log trades with automated price fetching and exchange rate pre-filling for a seamless experience.",
            icon: <Activity className="h-6 w-6" />,
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
                        <Wallet className="h-8 w-8" />
                        FinTracker
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
                            <Zap className="h-3 w-3" />
                            <span>v2.0 is now live</span>
                            <ChevronRight className="h-3 w-3" />
                        </div>
                        <h1 className="text-5xl font-extrabold tracking-tight text-base-900 dark:text-base-50 sm:text-7xl mb-8 max-w-4xl animate-in fade-in slide-in-from-bottom-8 duration-700">
                            Master Your Wealth with <span className="bg-gradient-to-r from-primary-600 to-indigo-600 bg-clip-text text-transparent">Precision Analytics</span>
                        </h1>
                        <p className="text-xl text-base-500 max-w-2xl mb-12 animate-in fade-in slide-in-from-bottom-10 duration-1000">
                            The modern financial tracker for young adults. Track global assets, analyze performance, and plan your life milestones in one beautiful dashboard.
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-12 duration-1000">
                            <Button size="lg" onClick={() => navigate('/dashboard')} className="h-14 px-8 text-lg bg-primary-600 hover:bg-primary-700 shadow-xl shadow-primary-200 group">
                                Start Your Journey
                                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                            </Button>
                        </div>

                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-24 bg-base-50/50 dark:bg-base-900/20">
                <div className="mx-auto max-w-7xl px-6">
                    <div className="mb-20 text-center">
                        <h2 className="text-sm font-semibold tracking-wide text-primary-600 dark:text-primary-400 uppercase mb-3">Capabilities</h2>
                        <h3 className="text-4xl font-bold text-base-900 dark:text-base-50">Built for modern portfolios</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4">
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
                                    <Activity className="h-4 w-4" />
                                    <span>Real-time Market Insights</span>
                                </div>
                                <h3 className="text-4xl font-bold text-white sm:text-5xl">Your Net Worth, <br />Everywhere, Simplified.</h3>
                                <p className="text-lg text-base-400">
                                    Stop manually updating spreadsheets. FinTracker connects your accounts and investments to provide a unified view of your financial health across currencies and asset classes.
                                </p>
                                <ul className="space-y-4">
                                    {[
                                        "Automated Equity Curve Calculation",
                                        "Historical Dividend Tracking",
                                        "Risk/Return Ratio Analysis",
                                        "Bank Account Integration"
                                    ].map((item, idx) => (
                                        <li key={idx} className="flex items-center gap-3 text-white/80">
                                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
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
                        <h2 className="text-4xl font-bold text-base-900 dark:text-base-50 sm:text-5xl">Ready to take control?</h2>
                        <p className="text-lg text-base-500 max-w-xl">
                            Join thousands of investors using FinTracker to build their future. Sign up today and get your financial journey started.
                        </p>
                        <div className="flex gap-4">
                            <Button size="lg" onClick={() => navigate('/signup')} className="h-14 px-12 text-lg bg-primary-600 hover:bg-primary-700 shadow-xl shadow-primary-200">
                                Create Your Account
                            </Button>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-base-400 mt-4">
                            <ShieldCheck className="h-4 w-4" />
                            No credit card required • Free forever version • Secure & Private
                        </div>
                    </div>
                </div>
            </section>

            <footer className="border-t border-base-200 dark:border-base-800 py-12">
                <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-2 text-xl font-bold text-base-900 dark:text-base-50">
                        <Wallet className="h-6 w-6 text-primary-600" />
                        FinTracker
                    </div>
                    <p className="text-sm text-base-500">© 2026 FinTracker Inc. All rights reserved.</p>
                    <div className="flex gap-6">
                        <Link to="#" className="text-sm text-base-400 hover:text-base-600 dark:hover:text-base-300">Privacy</Link>
                        <Link to="#" className="text-sm text-base-400 hover:text-base-600 dark:hover:text-base-300">Terms</Link>
                        <Link to="#" className="text-sm text-base-400 hover:text-base-600 dark:hover:text-base-300">Contact</Link>
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