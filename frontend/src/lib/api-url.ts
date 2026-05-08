export const getApiUrl = (path: string) => {
    const isServer = typeof window === 'undefined';

    // In Docker, the server (SSR) needs to talk to 'backend:5001'
    // The browser needs to talk to 'localhost:5001'
    // If running locally (not in Docker), both should use 'localhost:5001'
    let baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';

    if (isServer && process.env.INTERNAL_API_URL) {
        baseUrl = process.env.INTERNAL_API_URL;
    } else if (isServer && !process.env.INTERNAL_API_URL) {
        // If we are on the server but no internal URL is set, 
        // we fallback to the public VITE_API_URL (useful for local dev)
        baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    }

    const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;

    return `${cleanBaseUrl}${cleanPath}`;
};
