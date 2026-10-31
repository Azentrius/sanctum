// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.security.cert.Certificate;
import java.util.Iterator;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLPeerUnverifiedException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * TOFU certificate pinning for native HTTP (login/OCS) and pin management.
 * WebDAV traffic uses the same {@link CertPinStore} via {@link DavHttpPlugin}.
 */
@CapacitorPlugin(name = "CertPin")
public class CertPinPlugin extends Plugin {

    @PluginMethod
    public void syncPins(PluginCall call) {
        JSArray pins = call.getArray("pins", new JSArray());
        CertPinStore.getInstance().syncPins(pins);
        call.resolve();
    }

    @PluginMethod
    public void capturePin(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing 'url'");
            return;
        }

        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

        Request request = new Request.Builder().url(url).head().build();
        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call httpCall, IOException e) {
                call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
            }

            @Override
            public void onResponse(Call httpCall, Response response) {
                try (Response ignored = response) {
                    Certificate[] chain = response.handshake() != null
                        ? response.handshake().peerCertificates().toArray(new Certificate[0])
                        : null;
                    Set<String> hashes = CertPinStore.spkiPinsFromChain(chain);
                    if (hashes.isEmpty()) {
                        call.reject("No certificate chain received");
                        return;
                    }
                    JSArray hashArray = new JSArray();
                    for (String hash : hashes) {
                        hashArray.put(hash);
                    }
                    JSObject ret = new JSObject();
                    ret.put("hashes", hashArray);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject(e.getMessage() != null ? e.getMessage() : e.toString(), e);
                }
            }
        });
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Missing 'url'");
            return;
        }

        final String method = call.getString("method", "GET").toUpperCase();
        final String data = call.getString("data");
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
            if (data != null && permitsBody) {
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
        } catch (SSLPeerUnverifiedException e) {
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
