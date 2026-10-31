#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CertPinPlugin, "CertPin",
    CAP_PLUGIN_METHOD(syncPins, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(capturePin, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(request, CAPPluginReturnPromise);
)
