// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Native HTTP for WebDAV/CalDAV via OkHttp.
 *
 * Capacitor's built-in CapacitorHttp (and Android's HttpURLConnection it wraps)
 * cannot reliably send WebDAV verbs: setRequestMethod rejects PROPFIND/REPORT,
 * the reflection workaround is silently coerced to POST on modern Android, and
 * the request body does not reach Nextcloud's DAV endpoint. OkHttp speaks
 * arbitrary methods natively, sets Content-Length correctly and replays the
 * body across redirects: i.e. it behaves like curl, which works.
 *
 * Only the WebDAV traffic is routed here; the login flow stays on CapacitorHttp.
 */
@CapacitorPlugin(name = "DavHttp")
public class DavHttpPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing 'url'");
            return;
        }

        final String method = call.getString("method", "GET").toUpperCase();
        final String data = call.getString("data");
        final String dataBase64 = call.getString("dataBase64");
        final JSObject headers = call.getObject("headers", new JSObject());
        final int connectTimeout = call.getInt("connectTimeout", 30000);
        final int readTimeout = call.getInt("readTimeout", 30000);

        try {
            String contentType = null;
            Request.Builder builder = new Request.Builder().url(url);

            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.getString(key);
                    if (value == null) {
                        continue;
                    }
                    builder.header(key, value);
                    if (key.equalsIgnoreCase("Content-Type")) {
                        contentType = value;
                    }
                }
            }

            final boolean permitsBody = !method.equals("GET") && !method.equals("HEAD");
            final boolean requiresBody = method.equals("POST") || method.equals("PUT") || method.equals("PATCH");

            RequestBody body = null;
            MediaType mediaType = contentType != null ? MediaType.parse(contentType) : null;
            if (dataBase64 != null && permitsBody) {
                // Binary upload (e.g. WebDAV PUT of a picked file).
                byte[] bytes = android.util.Base64.decode(dataBase64, android.util.Base64.DEFAULT);
                body = RequestBody.create(bytes, mediaType);
            } else if (data != null && permitsBody) {
                body = RequestBody.create(data.getBytes("UTF-8"), mediaType);
            } else if (requiresBody) {
                body = RequestBody.create(new byte[0], null);
            }

            builder.method(method, body);

            OkHttpClient client = CertPinStore.getInstance()
                .newClientBuilder(connectTimeout, readTimeout)
                .build();

            try (Response response = client.newCall(builder.build()).execute()) {
                JSObject responseHeaders = new JSObject();
                Headers respHeaders = response.headers();
                for (int i = 0; i < respHeaders.size(); i++) {
                    responseHeaders.put(respHeaders.name(i), respHeaders.value(i));
                }

                String responseData = "";
                ResponseBody responseBody = response.body();
                if (responseBody != null) {
                    responseData = responseBody.string();
                }

                JSObject ret = new JSObject();
                ret.put("status", response.code());
                ret.put("headers", responseHeaders);
                ret.put("data", responseData);
                ret.put("url", response.request().url().toString());
                call.resolve(ret);
            }
        } catch (javax.net.ssl.SSLPeerUnverifiedException e) {
            if (CertPinStore.isPinMismatch(e)) {
                call.reject("Certificate pin mismatch", CertPinStore.PIN_MISMATCH_CODE, e);
                return;
            }
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
        } catch (Exception e) {
            if (CertPinStore.isPinMismatch(e)) {
                call.reject("Certificate pin mismatch", CertPinStore.PIN_MISMATCH_CODE, e);
                return;
            }
            call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
        }
    }
}
