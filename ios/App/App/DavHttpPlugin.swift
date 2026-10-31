// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Capacitor

/**
 * Native HTTP for WebDAV/CalDAV via URLSession.
 *
 * Capacitor's CapacitorHttp cannot reliably send WebDAV verbs and request
 * bodies to Nextcloud. URLSession speaks arbitrary methods (PROPFIND, REPORT,
 * ...) natively and delivers the body like curl. Only WebDAV traffic uses this;
 * the login flow stays on CapacitorHttp.
 */
@objc(DavHttpPlugin)
public class DavHttpPlugin: CAPPlugin {

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid 'url'")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        let data = call.getString("data")
        let dataBase64 = call.getString("dataBase64")
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

        if let dataBase64 = dataBase64, let decoded = Data(base64Encoded: dataBase64),
           method != "GET", method != "HEAD" {
            // Binary upload (e.g. WebDAV PUT of a picked file).
            request.httpBody = decoded
        } else if let data = data, method != "GET", method != "HEAD" {
            request.httpBody = data.data(using: .utf8)
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
