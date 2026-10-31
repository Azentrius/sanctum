// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import CryptoKit
import Security

/// In-memory TOFU certificate pins keyed by host. Hosts without a stored pin
/// use the system trust store (standard TLS validation).
final class CertPinStore {

    static let shared = CertPinStore()
    static let pinMismatchCode = "CERT_PIN_MISMATCH"

    private var pinsByHost: [String: Set<String>] = [:]
    private let lock = NSLock()

    private init() {}

    func syncPins(_ pins: [[String: Any]]) {
        lock.lock()
        defer { lock.unlock() }
        pinsByHost.removeAll()
        for entry in pins {
            guard let host = entry["host"] as? String, !host.isEmpty else { continue }
            let hashes = (entry["hashes"] as? [String])?.filter { !$0.isEmpty } ?? []
            if !hashes.isEmpty {
                pinsByHost[host] = Set(hashes)
            }
        }
    }

    func hasPin(forHost host: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let pins = pinsByHost[host] else { return false }
        return !pins.isEmpty
    }

    func expectedPins(forHost host: String) -> Set<String> {
        lock.lock()
        defer { lock.unlock() }
        return pinsByHost[host] ?? []
    }

    static func spkiSha256Pin(certificate: SecCertificate) -> String? {
        guard let key = SecCertificateCopyKey(certificate) else { return nil }
        var error: Unmanaged<CFError>?
        guard let spkiData = SecKeyCopyExternalRepresentation(key, &error) as Data? else {
            return nil
        }
        let digest = SHA256.hash(data: spkiData)
        let encoded = Data(digest).base64EncodedString()
        return "sha256/" + encoded
    }

    static func spkiPins(from trust: SecTrust) -> [String] {
        let count = SecTrustGetCertificateCount(trust)
        var pins: [String] = []
        for index in 0..<count {
            guard let certificate = SecTrustGetCertificateAtIndex(trust, index) else { continue }
            if let pin = spkiSha256Pin(certificate: certificate) {
                pins.append(pin)
            }
        }
        return pins
    }

    func validate(serverTrust: SecTrust, host: String) -> Bool {
        let expected = expectedPins(forHost: host)
        if expected.isEmpty {
            return true
        }
        let presented = Set(Self.spkiPins(from: serverTrust))
        return !presented.isDisjoint(with: expected)
    }

    /// Default system trust evaluation (chain, expiry, hostname, revocation as
    /// configured). Pinning is layered on top of this: never instead of it.
    static func evaluateSystemTrust(_ trust: SecTrust) -> Bool {
        var error: CFError?
        return SecTrustEvaluateWithError(trust, &error)
    }

    enum PinDecision: Equatable {
        case allow
        case reject
        case pinMismatch
    }

    /// Pure trust decision. System trust is the gate: a server that fails
    /// default validation is rejected as a standard TLS failure regardless of
    /// pin state: so an expired (or otherwise untrusted) certificate is never
    /// accepted just because its SPKI still matches a stored pin.
    static func decide(systemTrusted: Bool, hasPin: Bool, pinMatches: Bool) -> PinDecision {
        if !systemTrusted {
            return .reject
        }
        if !hasPin {
            return .allow
        }
        return pinMatches ? .allow : .pinMismatch
    }
}

final class PinningURLSessionDelegate: NSObject, URLSessionDelegate {

    var pinMismatch = false
    var capturedHashes: [String] = []

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let host = challenge.protectionSpace.host
        capturedHashes = CertPinStore.spkiPins(from: serverTrust)

        // Default system trust (chain/expiry/hostname) is enforced for every
        // host, pinned or not; pinning is an additional gate, never a
        // replacement. A failed system evaluation is a standard TLS failure,
        // not a pin mismatch, so it is rejected without setting pinMismatch.
        let hasPin = CertPinStore.shared.hasPin(forHost: host)
        let pinMatches = hasPin && CertPinStore.shared.validate(serverTrust: serverTrust, host: host)
        switch CertPinStore.decide(
            systemTrusted: CertPinStore.evaluateSystemTrust(serverTrust),
            hasPin: hasPin,
            pinMatches: pinMatches
        ) {
        case .allow:
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        case .reject:
            completionHandler(.cancelAuthenticationChallenge, nil)
        case .pinMismatch:
            pinMismatch = true
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

func certPinMismatchError() -> NSError {
    NSError(
        domain: CertPinStore.pinMismatchCode,
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Certificate pin mismatch"]
    )
}

func mapPinSessionError(_ error: Error?, delegate: PinningURLSessionDelegate) -> Error? {
    if delegate.pinMismatch {
        return certPinMismatchError()
    }
    return error
}
