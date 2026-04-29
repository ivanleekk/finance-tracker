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

function App() {

    return (
        <div className="flex overflow-hidden h-dvh">
            < Sidebar />
            <main>
                <Routes>
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/trade" element={<Trade />} />
                    <Route path="/portfolio" element={<Portfolio />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="/profile" element={<Profile />} />
                </Routes>
            </main>
        </div>
    )
}

export default App
