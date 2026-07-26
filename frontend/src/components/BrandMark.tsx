import { cn } from "../lib/utils"

/**
 * The Waypoint mark: an ascending line ending in a filled destination dot.
 *
 * Drawn on the same 24x24 / stroke-2 grid as the lucide icons it sits next to,
 * and stroked in `currentColor` so it picks up the theme's primary shade from
 * whatever wraps it. The iOS app icon (ios/scripts/gen_appicon.py) draws the
 * same geometry — keep the two in sync.
 */
export function BrandMark({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={cn("h-6 w-6", className)}
        >
            <path d="M3 18 L9 12 L13 16 L19 7" />
            <circle cx="19" cy="7" r="2.5" fill="currentColor" stroke="none" />
        </svg>
    )
}
