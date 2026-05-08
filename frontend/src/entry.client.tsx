// main.tsx
import { StrictMode } from 'react'
import { HydratedRouter } from 'react-router/dom';
import ReactDOM from 'react-dom/client'
import './index.css'

ReactDOM.hydrateRoot(
    document,
    <StrictMode>
        <HydratedRouter />
    </StrictMode>
);