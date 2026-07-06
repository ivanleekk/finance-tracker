// main.tsx
import { StrictMode } from 'react'
import { HydratedRouter } from 'react-router/dom';
import ReactDOM from 'react-dom/client'
import Clarity from '@microsoft/clarity'
import './index.css'

const clarityId = "wnvdf5ojnc";
Clarity.init(clarityId);

ReactDOM.hydrateRoot(
    document,
    <StrictMode>
        <HydratedRouter />
    </StrictMode>
);