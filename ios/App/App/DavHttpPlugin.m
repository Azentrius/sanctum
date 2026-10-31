#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the Swift DavHttpPlugin with Capacitor's plugin registry so it is
// reachable from JS as `DavHttp`.
CAP_PLUGIN(DavHttpPlugin, "DavHttp",
    CAP_PLUGIN_METHOD(request, CAPPluginReturnPromise);
)
