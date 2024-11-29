import type {Config} from "tailwindcss";

export default {
    darkMode: ["class"],
    content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter',"ui-sans-serif","system-ui","sans-serif",'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol','Noto Color Emoji',]
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)'
            },
            colors: {
                background: 'var(--background)',
                foreground: 'var(--foreground)',
                card: {
                    DEFAULT: 'var(--card)',
                    foreground: 'var(--card-foreground)'
                },
                popover: {
                    DEFAULT: 'var(--popover)',
                    foreground: 'var(--popover-foreground)'
                },
                primary: {
                    DEFAULT: 'var(--primary)',
                    foreground: 'var(--primary-foreground)'
                },
                secondary: {
                    DEFAULT: 'var(--secondary)',
                    foreground: 'var(--secondary-foreground)'
                },
                muted: {
                    DEFAULT: 'var(--muted)',
                    foreground: 'var(--muted-foreground)'
                },
                accent: {
                    DEFAULT: 'var(--accent)',
                    foreground: 'var(--accent-foreground)'
                },
                destructive: {
                    DEFAULT: 'var(--destructive)',
                    foreground: 'var(--destructive-foreground)'
                },
                border: 'var(--border)',
                input: 'var(--input)',
                ring: 'var(--ring)',
                sidebar: {
                    DEFAULT: 'var(--sidebar-background)',
                    foreground: 'var(--sidebar-foreground)',
                    primary: 'var(--sidebar-primary)',
                    'primary-foreground': 'var(--sidebar-primary-foreground)',
                    accent: 'var(--sidebar-accent)',
                    'accent-foreground': 'var(--sidebar-accent-foreground)',
                    border: 'var(--sidebar-border)',
                    ring: 'var(--sidebar-ring)'
                },
                'chetwode-blue': {
                    '50': '#eef4ff',
                    '100': '#e0ebff',
                    '200': '#c8d9fd',
                    '300': '#a6c0fb',
                    '400': '#829cf7',
                    '500': '#6c80f0',
                    '600': '#4853e3',
                    '700': '#3a42c8',
                    '800': '#3139a2',
                    '900': '#2f3780',
                    '950': '#1c1f4a',
                },
                'froly-red': {
                    '50': '#fef2f3',
                    '100': '#fde6e7',
                    '200': '#fbd0d5',
                    '300': '#f7aab2',
                    '400': '#f06c7b',
                    '500': '#e84b61',
                    '600': '#d32b4b',
                    '700': '#b21e3d',
                    '800': '#951c39',
                    '900': '#801b37',
                    '950': '#470a19',
                },
                'goldenrod': {
                    '50': '#fdfaed',
                    '100': '#faf0cb',
                    '200': '#f4e193',
                    '300': '#f0d16c',
                    '400': '#eab835',
                    '500': '#e3991d',
                    '600': '#c87617',
                    '700': '#a75516',
                    '800': '#884318',
                    '900': '#703717',
                    '950': '#401c08',
                },
                'pastel-green': {
                    '50': '#f0fdf2',
                    '100': '#dbfde2',
                    '200': '#b9f9c5',
                    '300': '#6cf088',
                    '400': '#45e367',
                    '500': '#1dca43',
                    '600': '#12a733',
                    '700': '#12832b',
                    '800': '#146727',
                    '900': '#125523',
                    '950': '#042f10',
                },
                'hillary': {
                    '50': '#f8f7f4',
                    '100': '#eeede6',
                    '200': '#dcdacc',
                    '300': '#c5c1ac',
                    '400': '#a79e82',
                    '500': '#9c9173',
                    '600': '#8f8167',
                    '700': '#776a57',
                    '800': '#62574a',
                    '900': '#51483d',
                    '950': '#2a2520',
                },



            }
        }
    },
    plugins: [require("tailwindcss-animate")],
} satisfies Config;
