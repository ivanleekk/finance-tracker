import Foundation
import Testing
@testable import FinanceTracker

/// `SessionStore.bootstrap` used to show the login screen for *any* launch failure, so a
/// cold start on a flaky network logged people out while their tokens were still valid.
/// `isAuthRejection` is the rule that separates "the server says this session is dead"
/// from "we couldn't find out".
struct SessionBootstrapTests {

    @Test func refreshRejectionIsAnAuthFailure() {
        #expect(SessionStore.isAuthRejection(APIError.sessionExpired))
    }

    @Test func a401AfterRefreshIsAnAuthFailure() {
        #expect(SessionStore.isAuthRejection(APIError.http(status: 401, detail: nil)))
    }

    @Test(arguments: [
        URLError(.notConnectedToInternet),
        URLError(.timedOut),
        URLError(.networkConnectionLost),
        URLError(.cannotConnectToHost),
        URLError(.cancelled),
    ])
    func transportFailuresKeepTheSession(_ error: URLError) {
        #expect(!SessionStore.isAuthRejection(error))
    }

    @Test(arguments: [403, 404, 500, 502, 503])
    func otherHTTPStatusesKeepTheSession(_ status: Int) {
        #expect(!SessionStore.isAuthRejection(APIError.http(status: status, detail: nil)))
    }

    @Test func decodeFailuresKeepTheSession() {
        let error = DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "bad"))
        #expect(!SessionStore.isAuthRejection(error))
    }
}
