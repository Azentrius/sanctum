// SPDX-License-Identifier: GPL-3.0-or-later
import { SearchNavDestination } from './search.model';

/** Stage-1 destinations: all modules and settings pages reachable in ≤2 taps. */
export const SEARCH_NAV_DESTINATIONS: SearchNavDestination[] = [
  {
    id: 'home',
    labelKey: 'search.NAV_HOME',
    icon: 'home-outline',
    route: ['/tabs/home'],
    keywords: ['dashboard', 'start'],
  },
  {
    id: 'calendar',
    labelKey: 'search.NAV_CALENDAR',
    icon: 'calendar-outline',
    route: ['/tabs/calendar'],
    keywords: ['termin', 'event', 'kalender'],
  },
  {
    id: 'tasks',
    labelKey: 'search.NAV_TASKS',
    icon: 'checkbox-outline',
    route: ['/tasks'],
    keywords: ['aufgabe', 'todo'],
  },
  {
    id: 'contacts',
    labelKey: 'search.NAV_CONTACTS',
    icon: 'people-outline',
    route: ['/contacts'],
    keywords: ['kontakt', 'adressbuch'],
  },
  {
    id: 'files',
    labelKey: 'search.NAV_FILES',
    icon: 'folder-outline',
    route: ['/tabs/files'],
    keywords: ['datei', 'ordner', 'dokument'],
  },
  {
    id: 'talk',
    labelKey: 'search.NAV_TALK',
    icon: 'chatbubbles-outline',
    route: ['/tabs/talk'],
    keywords: ['chat', 'nachricht'],
  },
  {
    id: 'notes',
    labelKey: 'search.NAV_NOTES',
    icon: 'document-text-outline',
    route: ['/notes'],
    keywords: ['notiz', 'markdown'],
  },
  {
    id: 'settings-accounts',
    labelKey: 'search.NAV_SETTINGS_ACCOUNTS',
    icon: 'people-circle-outline',
    route: ['/tabs/settings/accounts'],
    keywords: ['konto', 'account'],
  },
  {
    id: 'settings-language',
    labelKey: 'search.NAV_SETTINGS_LANGUAGE',
    icon: 'language-outline',
    route: ['/tabs/settings/language'],
    keywords: ['sprache', 'language', 'i18n'],
  },
  {
    id: 'settings-appearance',
    labelKey: 'search.NAV_SETTINGS_APPEARANCE',
    icon: 'contrast-outline',
    route: ['/tabs/settings/appearance'],
    keywords: ['theme', 'design', 'erscheinungsbild'],
  },
  {
    id: 'settings-security',
    labelKey: 'search.NAV_SETTINGS_SECURITY',
    icon: 'shield-checkmark-outline',
    route: ['/tabs/settings/security'],
    keywords: ['sicherheit', 'lock', 'pin'],
  },
];
