// SPDX-License-Identifier: GPL-3.0-or-later
import Foundation
import Capacitor

@objc(PrivacyScreenPlugin)
public class PrivacyScreenPlugin: CAPPlugin {
    private static var enabled = true

    static func isEnabled() -> Bool {
        return enabled
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        guard let requested = call.getBool("enabled") else {
            call.reject("Missing 'enabled'")
            return
        }
        PrivacyScreenPlugin.enabled = requested
        call.resolve()
    }
}
