// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import de.azentrius.sanctum.sync.SanctumSyncPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        CertPinStore.getInstance().attach(getApplicationContext());
        registerPlugin(DavHttpPlugin.class);
        registerPlugin(CertPinPlugin.class);
        registerPlugin(PrivacyScreenPlugin.class);
        registerPlugin(DistributionFlavorPlugin.class);
        registerPlugin(SanctumSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
