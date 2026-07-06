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
    }
})
