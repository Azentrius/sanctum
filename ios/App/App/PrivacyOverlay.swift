// SPDX-License-Identifier: GPL-3.0-or-later
import UIKit

/// Full-screen blur overlay shown while the app is inactive (app switcher).
final class PrivacyOverlay {
    static let shared = PrivacyOverlay()

    private var overlayView: UIVisualEffectView?

    private init() {}

    func show(on window: UIWindow?) {
        guard let window = window else {
            return
        }
        if overlayView != nil {
            return
        }

        let blur = UIBlurEffect(style: .regular)
        let blurView = UIVisualEffectView(effect: blur)
        blurView.frame = window.bounds
        blurView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        blurView.isUserInteractionEnabled = false
        window.addSubview(blurView)
        overlayView = blurView
    }

    func hide() {
        overlayView?.removeFromSuperview()
        overlayView = nil
    }
}
