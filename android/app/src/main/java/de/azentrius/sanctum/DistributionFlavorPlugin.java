// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exposes the Android product flavor ({@code play} | {@code foss}) to the JS layer.
 * Lane B (#59/#60) reads this via {@code getAppDistributionFlavor()} for PushProvider selection.
 */
@CapacitorPlugin(name = "DistributionFlavor")
public class DistributionFlavorPlugin extends Plugin {

    @PluginMethod
    public void getFlavor(PluginCall call) {
        JSObject result = new JSObject();
        result.put("flavor", BuildConfig.DISTRIBUTION_FLAVOR);
        call.resolve(result);
    }
}
