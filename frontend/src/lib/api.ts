const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5001').replace(/\/$/, '');

function apiUrl(endpoint: string) {
  return `${API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export async function fetchHealth() {
  const response = await fetch(apiUrl('/'), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
}

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(apiUrl(endpoint), {
    ...options,
    credentials: options.credentials ?? 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'An error occurred');
  }
  
  return response.json();
}
