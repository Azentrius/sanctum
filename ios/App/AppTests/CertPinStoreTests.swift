// SPDX-License-Identifier: GPL-3.0-or-later
import XCTest

/// Unit tests for the TOFU certificate-pinning trust decision.
///
/// `CertPinStore.swift` is compiled directly into this test target (see the
/// AppTests target in project.pbxproj), so no host application is required:
/// these are pure logic tests that run as an iOS unit-test bundle.
final class CertPinStoreTests: XCTestCase {

    override func setUp() {
        super.setUp()
        CertPinStore.shared.syncPins([])
    }

    // MARK: - decide(): the system-trust gate

    /// The exact case from issue #26: an expired (system-untrusted) certificate
    /// whose SPKI still matches a stored pin must be REJECTED, not accepted and
    /// not surfaced as a recoverable pin mismatch.
    func testExpiredCertWithMatchingPinIsRejected() {
        let decision = CertPinStore.decide(systemTrusted: false, hasPin: true, pinMatches: true)
        XCTAssertEqual(decision, .reject)
    }

    func testSystemUntrustedWithoutPinIsRejected() {
        let decision = CertPinStore.decide(systemTrusted: false, hasPin: false, pinMatches: false)
        XCTAssertEqual(decision, .reject)
    }

    func testTrustedWithMatchingPinIsAllowed() {
        let decision = CertPinStore.decide(systemTrusted: true, hasPin: true, pinMatches: true)
        XCTAssertEqual(decision, .allow)
    }

    func testTrustedWithMismatchingPinIsPinMismatch() {
        let decision = CertPinStore.decide(systemTrusted: true, hasPin: true, pinMatches: false)
        XCTAssertEqual(decision, .pinMismatch)
    }

    func testTrustedWithoutPinFallsBackToSystemTls() {
        let decision = CertPinStore.decide(systemTrusted: true, hasPin: false, pinMatches: false)
        XCTAssertEqual(decision, .allow)
    }

    // MARK: - pin store

    func testSyncPinsStoresAndExposesHashes() {
        CertPinStore.shared.syncPins([
            ["host": "cloud.example.com", "hashes": ["sha256/abc", "sha256/def"]],
        ])

        XCTAssertTrue(CertPinStore.shared.hasPin(forHost: "cloud.example.com"))
        XCTAssertEqual(
            CertPinStore.shared.expectedPins(forHost: "cloud.example.com"),
            ["sha256/abc", "sha256/def"]
        )
    }

    func testHostWithoutPinReportsNoPin() {
        XCTAssertFalse(CertPinStore.shared.hasPin(forHost: "unpinned.example.com"))
        XCTAssertTrue(CertPinStore.shared.expectedPins(forHost: "unpinned.example.com").isEmpty)
    }

    func testSyncPinsIgnoresEntriesWithoutHostOrHashes() {
        CertPinStore.shared.syncPins([
            ["hashes": ["sha256/abc"]],
            ["host": "no-hashes.example.com", "hashes": []],
            ["host": "ok.example.com", "hashes": ["sha256/ok"]],
        ])

        XCTAssertFalse(CertPinStore.shared.hasPin(forHost: "no-hashes.example.com"))
        XCTAssertTrue(CertPinStore.shared.hasPin(forHost: "ok.example.com"))
    }

    func testSyncPinsReplacesPreviousPins() {
        CertPinStore.shared.syncPins([
            ["host": "old.example.com", "hashes": ["sha256/old"]],
        ])
        CertPinStore.shared.syncPins([
            ["host": "new.example.com", "hashes": ["sha256/new"]],
        ])

        XCTAssertFalse(CertPinStore.shared.hasPin(forHost: "old.example.com"))
        XCTAssertTrue(CertPinStore.shared.hasPin(forHost: "new.example.com"))
    }
}
