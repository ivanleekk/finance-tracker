import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup after each test case
afterEach(() => {
  cleanup();
});

// Mock ResizeObserver which is not present in jsdom but used by recharts
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock scrollIntoView which is not implemented in jsdom (used by Select)
HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock window.matchMedia if needed
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock offsetWidth and offsetHeight for jsdom so recharts doesn't warn
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  value: 500,
});
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  value: 500,
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  value: 500,
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  value: 500,
});

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true
});
