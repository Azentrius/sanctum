// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum;

import android.content.Context;
import android.util.Base64;

import com.getcapacitor.JSArray;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import de.azentrius.sanctum.sync.PinPersistence;

import okhttp3.CertificatePinner;
import okhttp3.OkHttpClient;

/**
 * TOFU certificate pins keyed by host. When no pin is stored for a host, OkHttp
 * falls back to the system trust store (standard TLS). The app sends the pins;
 * once {@link #attach(Context)} ran they are also kept on disk, so a background
 * sync without the WebView pins the same keys.
 */
public final class CertPinStore {

    public static final String PIN_MISMATCH_CODE = "CERT_PIN_MISMATCH";

    private static final CertPinStore INSTANCE = new CertPinStore();

    private final Map<String, Set<String>> pinsByHost = new ConcurrentHashMap<>();

    private Context appContext;

    private CertPinStore() {}

    public static CertPinStore getInstance() {
        return INSTANCE;
    }

    /**
     * Gives the store a context to keep pins on disk, and loads the kept pins if
     * the app has not sent any in this process yet. Safe to call more than once.
     */
    public synchronized void attach(Context context) {
        if (appContext != null) {
            return;
        }
        appContext = context.getApplicationContext();
        if (pinsByHost.isEmpty()) {
            pinsByHost.putAll(PinPersistence.load(appContext));
        }
    }

    public synchronized void syncPins(JSArray pins) {
        pinsByHost.clear();
        if (pins == null) {
            if (appContext != null) {
                PinPersistence.save(appContext, pinsByHost);
            }
            return;
        }
        for (int i = 0; i < pins.length(); i++) {
            JSONObject entry = pins.optJSONObject(i);
            if (entry == null) {
                continue;
            }
            String host = entry.optString("host", null);
            JSONArray hashes = entry.optJSONArray("hashes");
            if (host == null || host.isEmpty() || hashes == null) {
                continue;
            }
            Set<String> hostPins = new HashSet<>();
            for (int j = 0; j < hashes.length(); j++) {
                String hash = hashes.optString(j, null);
                if (hash != null && !hash.isEmpty()) {
                    hostPins.add(hash);
                }
            }
            if (!hostPins.isEmpty()) {
                pinsByHost.put(host, Collections.unmodifiableSet(hostPins));
            }
        }
        if (appContext != null) {
            PinPersistence.save(appContext, pinsByHost);
        }
    }

    public boolean hasPinForHost(String host) {
        Set<String> pins = pinsByHost.get(host);
        return pins != null && !pins.isEmpty();
    }

    public OkHttpClient.Builder newClientBuilder(int connectTimeoutMs, int readTimeoutMs) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
            .followRedirects(true)
            .followSslRedirects(true);

        CertificatePinner pinner = buildCertificatePinner();
        if (pinner != null) {
            builder.certificatePinner(pinner);
        }
        return builder;
    }

    public static String spkiSha256Pin(X509Certificate certificate) {
        try {
            byte[] spki = certificate.getPublicKey().getEncoded();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(spki);
            return "sha256/" + Base64.encodeToString(hash, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to hash certificate SPKI", e);
        }
    }

    public static Set<String> spkiPinsFromChain(Certificate[] chain) {
        Set<String> pins = new HashSet<>();
        if (chain == null) {
            return pins;
        }
        for (Certificate certificate : chain) {
            if (certificate instanceof X509Certificate) {
                pins.add(spkiSha256Pin((X509Certificate) certificate));
            }
        }
        return pins;
    }

    public static boolean isPinMismatch(Throwable error) {
        if (error == null) {
            return false;
        }
        String message = error.getMessage();
        if (message != null && message.toLowerCase().contains("certificate pinning failure")) {
            return true;
        }
        Throwable cause = error.getCause();
        return cause != null && cause != error && isPinMismatch(cause);
    }

    private CertificatePinner buildCertificatePinner() {
        if (pinsByHost.isEmpty()) {
            return null;
        }
        CertificatePinner.Builder builder = new CertificatePinner.Builder();
        for (Map.Entry<String, Set<String>> entry : pinsByHost.entrySet()) {
            for (String pin : entry.getValue()) {
                builder.add(entry.getKey(), pin);
            }
        }
        return builder.build();
    }
}
