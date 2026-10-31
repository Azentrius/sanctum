// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.Context

/**
 * Keeps the certificate pins of [de.azentrius.sanctum.CertPinStore] across process restarts, so a
 * background sync pins the same keys as the app without the WebView. The app stays the source:
 * every list it sends replaces the stored one.
 *
 * One line per host: `host<TAB>pin,pin`. Pins are `sha256/<base64>`, which contain no tab or comma.
 */
object PinPersistence {
    private const val PREFS = "sanctum_cert_pins"
    private const val KEY = "pins"

    @JvmStatic
    fun save(context: Context, pinsByHost: Map<String, Set<String>>) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY, serialize(pinsByHost))
            .apply()
    }

    @JvmStatic
    fun load(context: Context): Map<String, Set<String>> =
        parse(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null).orEmpty())

    @JvmStatic
    fun serialize(pinsByHost: Map<String, Set<String>>): String =
        pinsByHost.entries
            .filter { (host, pins) -> host.isNotBlank() && pins.isNotEmpty() }
            .sortedBy { it.key }
            .joinToString("\n") { (host, pins) -> host + "\t" + pins.sorted().joinToString(",") }

    @JvmStatic
    fun parse(text: String): Map<String, Set<String>> =
        text.lineSequence()
            .mapNotNull { line ->
                val parts = line.split('\t')
                if (parts.size != 2 || parts[0].isBlank()) return@mapNotNull null
                val pins = parts[1].split(',').map { it.trim() }.filter { it.startsWith("sha256/") }.toSet()
                if (pins.isEmpty()) null else parts[0] to pins
            }
            .toMap()
}
