import { Badge } from "./Badge";

/** Shows a 🔒 PRIVATE / SHARED tag for an owned resource - only meaningful once a household exists. */
export function OwnershipTag({ ownerUserId, show = true, className }: { ownerUserId?: string | null; show?: boolean; className?: string }) {
    if (!show) return null;
    return ownerUserId ? (
        <Badge variant="private" className={className}>🔒 Private</Badge>
    ) : (
        <Badge variant="shared" className={className}>Shared</Badge>
    );
}
