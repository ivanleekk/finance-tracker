import SwiftUI

/// The standard treatment for a create/edit sheet: unsaved work can't be thrown away by
/// accident.
///
/// Every form in the app is a sheet, and a sheet is dismissed by dragging it down — which
/// used to discard a half-filled trade, transaction or account with no prompt and no undo.
/// Nothing on screen even suggested the work was at risk. Two halves fix that, and they have
/// to be applied together:
///
///  - `interactiveDismissDisabled` while the form is dirty, so the drag can't complete. This
///    is the part that actually prevents the loss; a pristine form still swipes away freely,
///    because there is nothing to protect and blocking it would just feel broken.
///  - Cancel asks before discarding, so there is still a deliberate way out that says what it
///    is about to do.
///
/// Dirtiness is decided by comparing the fields a form declares against the first values this
/// modifier saw, rather than by each form hand-rolling an "initial" copy of its own state:
/// the copies drift as forms gain fields, and a stale one silently stops guarding. A field
/// left off the list under-protects (the sheet behaves as it did before) rather than
/// misbehaving, which is the right way for this to fail.
///
/// It also owns the Cancel button, so the wording and the confirmation are identical on all
/// ten sheets instead of ten near-copies.
private struct DiscardGuard: ViewModifier {
    let fields: [AnyHashable]
    /// False while the form is still seeding itself. Forms don't all arrive fully populated:
    /// `AccountFormView` fills in the household currency and the private-by-default toggle in
    /// `onAppear` (SessionStore isn't reachable from `init`), and `QuickAddView` picks its
    /// default account, category and sub-portfolio only after a network round trip. Snapshotting
    /// "the values as first drawn" therefore caught a form mid-setup and called its own seeding
    /// a user edit — a brand-new account sheet asked "Discard changes?" before it had been
    /// touched. The baseline is taken when this turns true instead.
    let settled: Bool
    @Environment(\.dismiss) private var dismiss
    /// The values once the form finished setting itself up. Nil before that, so a form that is
    /// still seeding is never considered dirty.
    @State private var original: [AnyHashable]?
    @State private var isConfirming = false

    private var isDirty: Bool {
        guard let original else { return false }
        return original != fields
    }

    func body(content: Content) -> some View {
        content
            // `initial: true` covers the common case, where a form is born settled and this
            // fires once on appear. SwiftUI coalesces a seeding block into a single update, so
            // by the time the handler runs the seeded values are already in `fields`.
            .onChange(of: settled, initial: true) { _, isSettled in
                if isSettled, original == nil { original = fields }
            }
            .interactiveDismissDisabled(isDirty)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isDirty { isConfirming = true } else { dismiss() }
                    }
                }
            }
            .confirmationDialog(
                "Discard changes?", isPresented: $isConfirming, titleVisibility: .visible
            ) {
                Button("Discard Changes", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            } message: {
                Text("What you've entered on this form will be lost.")
            }
    }
}

extension View {
    /// Guard a create/edit sheet against discarding unsaved work, and give it its Cancel
    /// button. `fields` is the form's editable state — everything the user can change and
    /// would be upset to lose. Leave out incidentals like `isSaving` or `errorMessage`, and
    /// anything already persisted by the time it changes (a category created from within the
    /// form survives a cancel either way).
    /// Pass `settled: false` while a form is still filling in its own defaults — from
    /// `onAppear`, or from a fetch — so that seeding isn't mistaken for an edit. The baseline
    /// is taken the moment it turns true.
    func discardGuard(fields: [AnyHashable], settled: Bool = true) -> some View {
        modifier(DiscardGuard(fields: fields, settled: settled))
    }
}
