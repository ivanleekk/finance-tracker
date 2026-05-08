/**
 * This file serves as a 'Safelist' for Tailwind CSS v4.
 * By listing these class names, we force the JIT engine to generate the 
 * corresponding CSS variables (e.g. --color-yellow-500) so they are 
 * available for our dynamic theme engine at runtime.
 */

const colors = [
    "sky", "indigo", "violet", "rose", "emerald", "amber", "blue", "cyan", "teal",
    "fuchsia", "purple", "pink", "orange", "yellow", "lime", "red",
    "slate", "gray", "zinc", "neutral", "stone"
];

const shades = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

// This constant ensures Tailwind's static scanner sees every color/shade combination.
// We don't need to actually use this anywhere in the UI; its existence is enough.
export const _THEME_SAFELIST = `
    ${colors.map(c => shades.map(s => `bg-${c}-${s} text-${c}-${s} border-${c}-${s}`).join(" ")).join(" ")}
`;
