// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import at.bitfire.dav4jvm.ktor.DavResource
import at.bitfire.dav4jvm.ktor.responses
import at.bitfire.dav4jvm.ktor.responsesWithRelation
import at.bitfire.dav4jvm.ktor.resolve
import at.bitfire.dav4jvm.ktor.withTrailingSlash
import at.bitfire.dav4jvm.property.caldav.CalDAV
import at.bitfire.dav4jvm.property.caldav.CalendarColor
import at.bitfire.dav4jvm.property.caldav.CalendarHomeSet
import at.bitfire.dav4jvm.property.caldav.SupportedCalendarComponentSet
import at.bitfire.dav4jvm.property.webdav.CurrentUserPrincipal
import at.bitfire.dav4jvm.property.webdav.CurrentUserPrivilegeSet
import at.bitfire.dav4jvm.property.webdav.DisplayName
import at.bitfire.dav4jvm.property.webdav.ResourceType
import at.bitfire.dav4jvm.property.webdav.WebDAV
import io.ktor.client.HttpClient
import io.ktor.http.Url
import io.ktor.http.encodeURLPathPart
import kotlinx.coroutines.flow.toList
import at.bitfire.dav4jvm.ktor.Response as DavResponse

/** A calendar on the server that holds events. [url] ends with a slash. */
data class RemoteCalendar(
    val url: String,
    val displayName: String?,
    /** ARGB, or null when the server has none. */
    val color: Int?,
    val writable: Boolean,
)

/**
 * Finds the calendars of an account on its Nextcloud: the principal from the DAV root, its
 * calendar home, then every collection there that is a calendar and can hold events. Task lists,
 * subscriptions, the inbox and the trash bin are left out.
 */
internal class CalendarDiscovery(private val http: HttpClient) {

    suspend fun discover(account: SanctumAccount): List<RemoteCalendar> {
        val home = calendarHome(account)
        return DavResource(http, home)
            .propfind(
                1,
                WebDAV.ResourceType,
                WebDAV.DisplayName,
                WebDAV.CurrentUserPrivilegeSet,
                CalDAV.CalendarColor,
                CalDAV.SupportedCalendarComponentSet,
            )
            .responsesWithRelation()
            .toList()
            .filter { it.relation != DavResponse.HrefRelation.SELF && it.response.isSuccess() }
            .mapNotNull { toCalendar(it.response) }
    }

    private suspend fun calendarHome(account: SanctumAccount): Url {
        val root = DavResource(http, Url(account.serverUrl.trimEnd('/') + "/remote.php/dav/"))
        val principalHref = root.propfind(0, WebDAV.CurrentUserPrincipal)
            .responses()
            .toList()
            .firstNotNullOfOrNull { it[CurrentUserPrincipal::class.java]?.href }
        if (principalHref == null) {
            // Nextcloud's own layout, for a server that does not name the principal
            return root.location.resolve("calendars/${account.username.encodeURLPathPart()}/")
                ?: throw SyncFailure(SyncOutcome.Code.SERVER, "no calendar home")
        }
        val principal = root.location.resolve(principalHref)
            ?: throw SyncFailure(SyncOutcome.Code.SERVER, "no principal")

        val principalResource = DavResource(http, principal)
        val homeHref = principalResource.propfind(0, CalDAV.CalendarHomeSet)
            .responses()
            .toList()
            .firstNotNullOfOrNull { it[CalendarHomeSet::class.java]?.hrefs?.firstOrNull() }
            ?: throw SyncFailure(SyncOutcome.Code.SERVER, "no calendar home")
        return principalResource.location.resolve(homeHref)?.withTrailingSlash()
            ?: throw SyncFailure(SyncOutcome.Code.SERVER, "no calendar home")
    }

    private fun toCalendar(response: DavResponse): RemoteCalendar? {
        val types = response[ResourceType::class.java]?.types ?: return null
        if (CalDAV.Calendar !in types) return null
        val components = response[SupportedCalendarComponentSet::class.java]
        if (components != null && !components.supportsEvents) return null
        return RemoteCalendar(
            url = response.href.withTrailingSlash().toString(),
            displayName = response[DisplayName::class.java]?.displayName?.takeIf { it.isNotBlank() },
            color = response[CalendarColor::class.java]?.color,
            writable = response[CurrentUserPrivilegeSet::class.java]?.mayWriteContent ?: false,
        )
    }
}

/** A sync that cannot go on, with the outcome to report. */
internal class SyncFailure(val code: SyncOutcome.Code, message: String) : Exception(message)
