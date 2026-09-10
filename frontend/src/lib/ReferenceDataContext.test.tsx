import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { ReferenceDataProvider, useReferenceData } from "./ReferenceDataContext";
import api from "./api";
import type { HouseholdResponse } from "../types/types";

// The provider reads only `activeHousehold`; mocking the hook keeps the household context's
// own surface unchanged (it deliberately doesn't export its context object).
const activeHousehold = { current: null as HouseholdResponse | null };
vi.mock("./HouseholdContext", () => ({
    useHousehold: () => ({ activeHousehold: activeHousehold.current }),
}));

/**
 * The command bar's reference data (`ReferenceDataContext`) is what stops ⌘K opening with no
 * accounts to parse against on a cold page load (#272). The twin of iOS's
 * `ReferenceDataStoreTests` and Android's `ReferenceDataViewModelTest`, minus the parts that
 * only make sense with a real backend.
 */

const household = { id: "hh-1", name: "Test", base_currency: "SGD" } as unknown as HouseholdResponse;

function Probe() {
    const { accounts, categories, subportfolios, recent, status, hasEssentials, failureMessage, reload } =
        useReferenceData();
    return (
        <div>
            <span data-testid="status">{status.kind}</span>
            <span data-testid="essentials">{String(hasEssentials)}</span>
            <span data-testid="failure">{failureMessage ?? ""}</span>
            <span data-testid="counts">
                {accounts.length}/{categories.length}/{subportfolios.length}/{recent.length}
            </span>
            <button onClick={reload}>reload</button>
        </div>
    );
}

function renderWithHousehold(active: HouseholdResponse | null) {
    activeHousehold.current = active;
    return render(
        <ReferenceDataProvider>
            <Probe />
        </ReferenceDataProvider>,
    );
}

/** Resolve each endpoint independently so the two stages can be observed apart. */
function stubApi(overrides: Record<string, unknown[]> = {}) {
    return vi.spyOn(api, "get").mockImplementation((url: string) => {
        const key = url.includes("/accounts/household") ? "accounts"
            : url.includes("/cashflow/categories") ? "categories"
                : url.includes("/portfolio/subportfolios") ? "subportfolios"
                    : "recent";
        return Promise.resolve({ data: overrides[key] ?? [] }) as never;
    });
}

describe("ReferenceDataContext", () => {
    afterEach(() => vi.restoreAllMocks());
    beforeEach(() => vi.clearAllMocks());

    it("has nothing to show, and is idle rather than failed, with no household", async () => {
        const get = stubApi();
        renderWithHousehold(null);
        expect(screen.getByTestId("status").textContent).toBe("idle");
        expect(screen.getByTestId("essentials").textContent).toBe("false");
        expect(get).not.toHaveBeenCalled();
    });

    it("loads once the household resolves, accounts and categories first", async () => {
        stubApi({
            accounts: [{ id: "a1" }],
            categories: [{ id: "c1" }],
            subportfolios: [{ id: "s1" }],
            recent: [{ id: "t1", date: "2026-01-01" }],
        });
        renderWithHousehold(household);
        await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
        expect(screen.getByTestId("counts").textContent).toBe("1/1/1/1");
        expect(screen.getByTestId("essentials").textContent).toBe("true");
    });

    /** The bar shows three; asking for more than that is deliberate headroom, but asking for
     *  the household's *entire* history to display three was the old behaviour and by far the
     *  heaviest of the four requests. */
    it("caps the transaction request instead of pulling the whole history", async () => {
        const get = stubApi();
        renderWithHousehold(household);
        await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
        const transactionCall = get.mock.calls
            .map(c => String(c[0]))
            .find(u => u.includes("/cashflow/transactions/household"));
        expect(transactionCall).toContain("limit=");
    });

    /**
     * The regression this exists to prevent, in miniature: a *refresh* that fails must not take
     * the already-loaded pickers down with it. `hasEssentials` therefore latches rather than
     * being read back off the current status.
     */
    it("keeps what already landed when a refresh fails", async () => {
        const get = stubApi({ accounts: [{ id: "a1" }], categories: [{ id: "c1" }] });
        renderWithHousehold(household);
        await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));

        get.mockImplementation(() => Promise.reject(new Error("Network Error")) as never);
        await act(async () => {
            screen.getByText("reload").click();
        });

        await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("failed"));
        expect(screen.getByTestId("failure").textContent).toBe("Network Error");
        // Still usable — this is the whole point.
        expect(screen.getByTestId("essentials").textContent).toBe("true");
        expect(screen.getByTestId("counts").textContent).toBe("1/1/0/0");
    });
});
