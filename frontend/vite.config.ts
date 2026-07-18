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
        watch: {
            // Vite only ignores node_modules/.git by default; keep bulky
            // generated dirs out of the (polling) watcher. NOTE: this only
            // covers Vite's own watcher - @react-router/dev's child compiler
            // creates a second Vite server that drops server.watch entirely,
            // and chokidar reads CHOKIDAR_USEPOLLING from the env on its own
            // (default interval 100ms). That watcher is only tameable via the
            // CHOKIDAR_INTERVAL env var - see docker-compose.override.yml.
            ignored: ['**/.pnpm-store/**', '**/build/**', '**/.react-router/**'],
            ...(process.env.CHOKIDAR_USEPOLLING === 'true'
                ? { usePolling: true, interval: 300 }
                : {}),
        },
    }
})
