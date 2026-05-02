import './index.css'
import Sidebar from './components/sidebar.tsx'
import { Routes, Route } from "react-router";
import LandingPage from './LandingPage.tsx'
import Dashboard from './Dashboard.tsx';
import Trade from './Trade.tsx';
import Portfolio from './Portfolio.tsx';
import History from './History.tsx';
import Settings from './Settings.tsx';
import Profile from './Profile.tsx';
import Accounts from './Accounts.tsx';
import Households from './Households.tsx';

function App() {
    return (
        <div className="flex h-dvh overflow-hidden bg-base-50">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/accounts" element={<Accounts />} />
                    <Route path="/trade" element={<Trade />} />
                    <Route path="/portfolio" element={<Portfolio />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/households" element={<Households />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/profile" element={<Profile />} />
                </Routes>
            </main>
        </div>
    )
}

export default App
