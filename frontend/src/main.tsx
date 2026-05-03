// main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from "./lib/AuthContext";
import { HouseholdProvider } from "./lib/HouseholdContext";
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <AuthProvider>
            <HouseholdProvider>
                <App />
            </HouseholdProvider>
        </AuthProvider>
    </StrictMode>,
)