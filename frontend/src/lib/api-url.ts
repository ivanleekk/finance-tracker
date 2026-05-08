export const getApiUrl = (path: string) => {
    const isServer = typeof window === 'undefined';

    // In Docker, the server (SSR) needs to talk to 'backend:5001'
    // The browser needs to talk to 'localhost:5001'
    const baseUrl = isServer 
        ? (process.env.INTERNAL_API_URL || 'http://backend:5001')
        : (import.meta.env.VITE_API_URL || 'http://localhost:5001');

    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    return `${cleanBaseUrl}${cleanPath}`;
};
