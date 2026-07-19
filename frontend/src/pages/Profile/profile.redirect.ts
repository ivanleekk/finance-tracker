import { redirect } from "react-router";

// Profile has been merged into Settings — keep old links/bookmarks working.
export function loader() {
    return redirect("/settings");
}
