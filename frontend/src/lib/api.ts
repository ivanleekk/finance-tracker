import axios from 'axios';

// Detect if we are running on the server (SSR) or in the browser
const isServer = typeof window === 'undefined';

const api = axios.create({
  // Use 'backend' service name when on server, 'localhost' when in browser
  baseURL: isServer
    ? (process.env.INTERNAL_API_URL || import.meta.env.VITE_API_URL || 'http://backend:8000')
    : (import.meta.env.VITE_API_URL || 'http://localhost:8000'),
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export default api;
