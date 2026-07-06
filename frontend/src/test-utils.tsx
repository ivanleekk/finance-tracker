/* eslint-disable react-refresh/only-export-components */
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import axios from 'axios';
import { HouseholdProvider } from './lib/HouseholdContext';

export const setupAuth = async () => {
    try {
        const formData = new URLSearchParams();
        formData.append('username', 'test@example.com');
        formData.append('password', 'password');

        const response = await axios.post('http://localhost:8000/auth/token', formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const token = response.data.access_token;
        document.cookie = `access_token=${token}; path=/;`;
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        return token;
    } catch (error) {
        console.warn('Could not authenticate with backend. Ensure backend is running.', error);
        return null;
    }
};

export const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  routeOptions?: { path?: string; initialEntries?: string[]; loader?: any }
) => {
    const { path = '/', initialEntries = ['/'], loader } = routeOptions || {};

    const defaultLoader = () => ({
        accounts: [],
        balances: {},
        transactions: [],
        subPortfolios: [],
        snapshots: [],
        metrics: null,
    });

    const mockHousehold = {
        id: "mock-household-123",
        name: "Test Household",
        currency: "USD",
        owner_id: "user-123"
    };

    const ContextWrapper = () => (
        <HouseholdProvider initialHouseholds={[mockHousehold]}>
            {ui}
        </HouseholdProvider>
    );

    const router = createMemoryRouter(
        [
            {
                path,
                element: <ContextWrapper />,
                loader: loader || defaultLoader,
                HydrateFallback: () => <div>Loading...</div>,
            },
            {
                path: '/login',
                element: <div>Login Page</div>
            }
        ],
        {
            initialEntries,
        }
    );

    return render(<RouterProvider router={router} />, options);
};

export * from '@testing-library/react';
export { customRender as render };
