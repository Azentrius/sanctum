// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DavHttpPlugin.class);
        registerPlugin(CertPinPlugin.class);
        registerPlugin(PrivacyScreenPlugin.class);
        registerPlugin(DistributionFlavorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
