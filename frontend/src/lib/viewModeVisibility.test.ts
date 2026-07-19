import { describe, it, expect } from "vitest";
import { isVisibleInViewMode } from "./ViewModeContext";

// The private/household/blended visibility rule is the client half of the
// private-ownership enforcement (the server enforces the other half). A savvy
// user switching view modes must never see another member's private item, and
// must never lose sight of their own.

const ME = "user-me";
const OTHER = "user-other";

describe("isVisibleInViewMode", () => {
    describe("blended (my things + shared)", () => {
        it("shows shared items", () => {
            expect(isVisibleInViewMode(null, "blended", ME)).toBe(true);
            expect(isVisibleInViewMode(undefined, "blended", ME)).toBe(true);
        });
        it("shows my own private items", () => {
            expect(isVisibleInViewMode(ME, "blended", ME)).toBe(true);
        });
        it("HIDES another member's private items", () => {
            expect(isVisibleInViewMode(OTHER, "blended", ME)).toBe(false);
        });
    });

    describe("household (everything shared, nothing private)", () => {
        it("shows shared items", () => {
            expect(isVisibleInViewMode(null, "household", ME)).toBe(true);
        });
        it("hides ALL private items, even my own", () => {
            expect(isVisibleInViewMode(ME, "household", ME)).toBe(false);
            expect(isVisibleInViewMode(OTHER, "household", ME)).toBe(false);
        });
    });

    describe("private (only my own private)", () => {
        it("shows my own private items", () => {
            expect(isVisibleInViewMode(ME, "private", ME)).toBe(true);
        });
        it("hides shared items", () => {
            expect(isVisibleInViewMode(null, "private", ME)).toBe(false);
        });
        it("hides another member's private items", () => {
            expect(isVisibleInViewMode(OTHER, "private", ME)).toBe(false);
        });
    });

    describe("hostile / degenerate inputs", () => {
        it("never leaks another user's private item when currentUserId is unknown", () => {
            // No matter the mode, an item owned by someone else must not show when
            // we can't prove it's ours.
            for (const mode of ["blended", "household", "private"] as const) {
                expect(isVisibleInViewMode(OTHER, mode, undefined)).toBe(false);
            }
        });

        it("does not treat empty-string owner as a real owner", () => {
            // Empty string is falsy -> treated as shared, matching the backend's
            // NULL-is-shared convention.
            expect(isVisibleInViewMode("", "household", ME)).toBe(true);
            expect(isVisibleInViewMode("", "blended", ME)).toBe(true);
        });
    });
});
