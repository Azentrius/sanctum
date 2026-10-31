// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Toggles FLAG_SECURE on the Capacitor activity window at runtime so sensitive
 * content can be hidden from screenshots, screen recording, and the app switcher.
 */
@CapacitorPlugin(name = "PrivacyScreen")
public class PrivacyScreenPlugin extends Plugin {

    private boolean enabled = true;

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean requested = call.getBoolean("enabled");
        if (requested == null) {
            call.reject("Missing 'enabled'");
            return;
        }

        enabled = requested;
        getActivity().runOnUiThread(() -> applyFlagSecure(enabled));
        call.resolve();
    }

    private void applyFlagSecure(boolean secure) {
        if (getActivity() == null) {
            return;
        }
        if (secure) {
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }
}
