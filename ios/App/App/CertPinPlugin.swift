// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Capacitor

/**
 * TOFU certificate pinning for native HTTP (login/OCS) and pin management.
 * WebDAV traffic uses the same CertPinStore via DavHttpPlugin.
 */
@objc(CertPinPlugin)
public class CertPinPlugin: CAPPlugin {

    @objc func syncPins(_ call: CAPPluginCall) {
        let pins = call.getArray("pins", []) ?? []
        let entries = pins.compactMap { $0 as? [String: Any] }
        CertPinStore.shared.syncPins(entries)
        call.resolve()
    }

    @objc func capturePin(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid 'url'")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        request.timeoutInterval = 15

        let delegate = PinningURLSessionDelegate()
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        let task = session.dataTask(with: request) { _, _, error in
            if let mapped = mapPinSessionError(error, delegate: delegate) {
                call.reject(mapped.localizedDescription, CertPinStore.pinMismatchCode, mapped)
                return
            }
            if let error = error {
                call.reject(error.localizedDescription, nil, error)
                return
            }
            if delegate.capturedHashes.isEmpty {
                call.reject("No certificate chain received")
                return
            }
            call.resolve(["hashes": delegate.capturedHashes])
        }
        task.resume()
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid 'url'")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        let data = call.getString("data")
        let headers = call.getObject("headers") ?? [:]
        let connectTimeout = call.getInt("connectTimeout") ?? 30000
        let readTimeout = call.getInt("readTimeout") ?? 30000

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = TimeInterval(readTimeout) / 1000.0

        for (key, value) in headers {
            if let stringValue = value as? String {
                request.setValue(stringValue, forHTTPHeaderField: key)
            }
        }

        if let data = data, method != "GET", method != "HEAD" {
            request.httpBody = data.data(using: .utf8)
        } else if method == "POST" || method == "PUT" || method == "PATCH" {
            request.httpBody = Data()
        }

        let delegate = PinningURLSessionDelegate()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = TimeInterval(connectTimeout) / 1000.0
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)

        let task = session.dataTask(with: request) { (responseData, response, error) in
            if let mapped = mapPinSessionError(error, delegate: delegate) {
                call.reject(mapped.localizedDescription, CertPinStore.pinMismatchCode, mapped)
                return
            }
            if let error = error {
                call.reject(error.localizedDescription, nil, error)
                return
            }
            guard let httpResponse = response as? HTTPURLResponse else {
                call.reject("Invalid response")
                return
            }

            var responseHeaders = JSObject()
            for (key, value) in httpResponse.allHeaderFields {
                if let keyString = key as? String {
                    responseHeaders[keyString] = String(describing: value)
                }
            }

            let bodyString = responseData.flatMap { String(data: $0, encoding: .utf8) } ?? ""

            var result = JSObject()
            result["status"] = httpResponse.statusCode
            result["headers"] = responseHeaders
            result["data"] = bodyString
            result["url"] = httpResponse.url?.absoluteString ?? urlString
            call.resolve(result)
        }
        task.resume()
    }
}
