import SwiftUI

/// Manage who is in the active household: current members and pending email invites.
/// Invites auto-accept when the invited email signs up or logs in (resolve_pending_invites).
/// Pushed from the More tab, so it uses the caller's NavigationStack.
struct HouseholdMembersView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ViewModeStore.self) private var viewModeStore

    @State private var members: [HouseholdMemberUserResponse] = []
    @State private var invites: [HouseholdInviteResponse] = []
    @State private var isLoading = true
    @State private var showingInvite = false
    @State private var errorMessage: String?

    private var household: HouseholdResponse? { session.activeHousehold }

    /// Only pending invites are actionable; accepted ones already became members.
    private var pendingInvites: [HouseholdInviteResponse] {
        invites.filter { $0.status.lowercased() == "pending" }
    }

    var body: some View {
        List {
            Section("Members") {
                if members.isEmpty && !isLoading {
                    Text("No members yet.").foregroundStyle(.secondary)
                }
                ForEach(members) { member in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.name)
                            Text(member.email)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(member.role.label)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .onDelete { offsets in removeMembers(at: offsets) }
            }

            if !pendingInvites.isEmpty {
                Section("Pending Invites") {
                    ForEach(pendingInvites) { invite in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(invite.email)
                                Text("Invited · \(invite.role.label)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "clock")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .onDelete { offsets in cancelInvites(at: offsets) }
                }
            }
        }
        .navigationTitle("Household")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingInvite = true
                } label: {
                    Label("Invite", systemImage: "person.badge.plus")
                }
                .disabled(household == nil)
            }
        }
        .sheet(isPresented: $showingInvite) {
            if let household {
                InviteMemberView(householdId: household.id) { await load() }
            }
        }
        .overlay {
            if isLoading && members.isEmpty { LoadingSkeleton() }
        }
        .refreshable { await load() }
        .task { await load() }
        .alert("Error", isPresented: .init(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func load() async {
        guard let household else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let membersReq: [HouseholdMemberUserResponse] = APIClient.shared.get("/users/householdmember/\(household.id)")
            async let invitesReq: [HouseholdInviteResponse] = APIClient.shared.get("/users/households/\(household.id)/invites")
            (members, invites) = try await (membersReq, invitesReq)
            // Keep the global Private/Household/Blended switch in sync: it appears only
            // once there's a second person, which is exactly what this screen changes.
            viewModeStore.setComposition(memberCount: members.count, pendingInviteCount: pendingInvites.count)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func removeMembers(at offsets: IndexSet) {
        // You can't remove yourself here; the backend also enforces owner rules.
        let targets = offsets.map { members[$0] }.filter { $0.userId != session.user?.id }
        Task {
            do {
                for member in targets {
                    try await APIClient.shared.delete("/users/householdmember/\(member.id)")
                }
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func cancelInvites(at offsets: IndexSet) {
        let targets = offsets.map { pendingInvites[$0] }
        Task {
            do {
                for invite in targets {
                    try await APIClient.shared.delete("/users/invites/\(invite.id)")
                }
                await load()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// Invite someone to the household by email; they auto-join on sign-up/login.
struct InviteMemberView: View {
    @Environment(\.dismiss) private var dismiss

    let householdId: String
    let onSaved: () async -> Void

    @State private var email = ""
    @State private var role: HouseholdRole = .editor
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var canSave: Bool {
        email.contains("@") && email.contains(".") && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Picker("Role", selection: $role) {
                        Text(HouseholdRole.editor.label).tag(HouseholdRole.editor)
                        Text(HouseholdRole.viewer.label).tag(HouseholdRole.viewer)
                    }
                } footer: {
                    Text("Editors can make changes; viewers have read-only access. The invite is accepted automatically when they sign up or log in with this email.")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Invite Member")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { save() }
                        .disabled(!canSave)
                }
            }
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        let cleanEmail = email.trimmingCharacters(in: .whitespaces).lowercased()
        Task {
            defer { isSaving = false }
            do {
                let _: HouseholdInviteResponse = try await APIClient.shared.post(
                    "/users/households/\(householdId)/invites",
                    body: HouseholdInviteCreate(email: cleanEmail, role: role)
                )
                await onSaved()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
