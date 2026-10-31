#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(PrivacyScreenPlugin, "PrivacyScreen",
    CAP_PLUGIN_METHOD(setEnabled, CAPPluginReturnPromise);
)
