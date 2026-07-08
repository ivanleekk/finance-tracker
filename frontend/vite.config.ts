import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import {reactRouter} from "@react-router/dev/vite"

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        reactRouter(),
        // babel({ presets: [reactCompilerPreset()] }),
        tailwindcss(),
    ],
    server: {
        host: true,
        // Bind-mounted volumes (e.g. Docker Desktop on macOS/Windows) don't always
        // propagate native filesystem events, so HMR silently stops picking up
        // changes. CHOKIDAR_USEPOLLING=true (set by docker-compose.override.yml)
        // falls back to polling - Vite doesn't read that env var on its own.
        watch: process.env.CHOKIDAR_USEPOLLING === 'true'
            ? { usePolling: true, interval: 300 }
            : undefined,
    }
})
