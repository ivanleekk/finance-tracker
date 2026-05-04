import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import {reactRouter} from "@react-router/dev/vite"
import babel from '@rolldown/plugin-babel'

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
