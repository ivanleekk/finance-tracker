import { useNavigate } from "react-router"
import { Button } from "./components/ui/Button"
import { Wallet } from "lucide-react"

export default function LandingPage() {
    const navigate = useNavigate()

    return (
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center h-full">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-100 text-primary-600 mb-8">
                <Wallet className="h-10 w-10" />
            </div>
            <h1 className="text-5xl font-bold tracking-tight text-base-900 mb-6">
                Welcome to FinTracker
            </h1>
            <p className="text-xl text-base-500 mb-10 max-w-2xl">
                Take control of your financial future. Track your portfolio, execute trades, and set goals with our powerful, intuitive dashboard.
            </p>
            <div className="flex gap-4">
                <Button size="lg" variant="primary" onClick={() => navigate('/dashboard')}>
                    Get Started
                </Button>
                <Button size="lg" variant="secondary" onClick={() => navigate('/portfolio')}>
                    View Demo Portfolio
                </Button>
            </div>
        </div>
    )
}