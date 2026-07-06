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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // If the error is 401 and we haven't retried yet
    if (
      error.response?.status === 401 && 
      !originalRequest._retry && 
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/token')
    ) {
      originalRequest._retry = true;
      
      try {
        // Attempt to refresh the token
        await api.post('/auth/refresh');
        
        // If successful, retry the original request
        return api(originalRequest);
      } catch (refreshError) {
        // If refresh fails, we can't do much else
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default api;
