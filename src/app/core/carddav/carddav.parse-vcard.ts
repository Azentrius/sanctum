// SPDX-License-Identifier: GPL-3.0-or-later
import ICAL from 'ical.js';
import { v4 as uuidv4 } from 'uuid';

import { Contact, ContactAddress, ContactField } from './contact.model';

export function parseVCard(
  vCardData: string,
  accountId: string,
  addressBookId: string,
  url?: string,
  etag?: string,
): Contact {
  try {
    return parseVCardWithIcal(vCardData, accountId, addressBookId, url, etag);
  } catch {
    return parseVCardManual(vCardData, accountId, addressBookId, url, etag);
  }
}

export function unfoldLines(raw: string): string[] {
  const normalized = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const unfolded = normalized.replaceAll(/\n[ \t]/g, '');
  return unfolded.split('\n').filter((line) => line.length > 0);
}

export function parseVCardManual(
  vCardData: string,
  accountId: string,
  addressBookId: string,
  url?: string,
  etag?: string,
): Contact {
  const lines = unfoldLines(vCardData);
  const phones: ContactField[] = [];
  const emails: ContactField[] = [];
  const addresses: ContactAddress[] = [];
  let uid = '';
  let displayName = '';
  let firstName: string | undefined;
  let lastName: string | undefined;
  let organization: string | undefined;
  let notes: string | undefined;
  let birthday: Date | undefined;
  let photoUrl: string | undefined;

  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const rawName = line.slice(0, separator);
    const value = unescape(line.slice(separator + 1));
    const [namePart, ...paramParts] = rawName.split(';');
    const name = namePart.split('.').pop()!.toUpperCase();
    const type = typeFromParams(paramParts);

    switch (name) {
      case 'UID':
        uid = value;
        break;
      case 'FN':
        displayName = value;
        break;
      case 'N': {
        const parts = value.split(';');
        lastName = parts[0]?.trim() || undefined;
        firstName = parts[1]?.trim() || undefined;
        break;
      }
      case 'ORG':
        organization = value.split(';')[0]?.trim() || undefined;
        break;
      case 'TEL':
        if (value.trim()) {
          phones.push({ type, value: value.trim() });
        }
        break;
      case 'EMAIL':
        if (value.trim()) {
          emails.push({ type, value: value.trim() });
        }
        break;
      case 'ADR': {
        const parts = value.split(';');
        const address: ContactAddress = {
          type,
          street: parts[2]?.trim() || undefined,
          city: parts[3]?.trim() || undefined,
          postalCode: parts[5]?.trim() || undefined,
          country: parts[6]?.trim() || undefined,
        };
        if (hasAddressContent(address)) {
          addresses.push(address);
        }
        break;
      }
      case 'NOTE':
        notes = value.trim() || undefined;
        break;
      case 'BDAY':
        birthday = parseBirthday(value);
        break;
      case 'PHOTO':
        photoUrl = buildPhotoDataUri(line.slice(separator + 1), type);
        break;
      default:
        break;
    }
  }

  return {
    id: uid || filenameUid(url) || uuidv4(),
    accountId,
    addressBookId,
    url: url ?? '',
    etag,
    displayName: displayName || `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Unbenannt',
    firstName,
    lastName,
    organization,
    phones,
    emails,
    addresses,
    birthday,
    notes,
    photoUrl,
    rawVCard: vCardData,
  };
}

export function buildPhotoDataUri(value: string, typeParam: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^(data:|https?:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  const type = typeParam && typeParam.toLowerCase() !== 'other' ? typeParam : 'jpeg';
  const mime = `image/${type.toLowerCase().replace('jpg', 'jpeg')}`;
  const base64 = trimmed.replace(/\s+/g, '');
  return `data:${mime};base64,${base64}`;
}

export function normalizeType(param: unknown): string {
  if (Array.isArray(param)) {
    const entries = param
      .map((entry) => firstStringValue(entry).toLowerCase())
      .filter((entry) => entry.length > 0);
    const meaningful = entries.find(
      (entry) => entry !== 'pref' && entry !== 'voice' && entry !== 'internet',
    );
    return meaningful ?? entries[0] ?? 'other';
  }
  if (typeof param === 'string' && param.length > 0) {
    return param.toLowerCase();
  }
  return 'other';
}

export function firstStringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return firstStringValue(value[0]);
  }
  if (typeof value === 'object' && value !== null) {
    const rendered = (value as { toString: () => unknown }).toString();
    return typeof rendered === 'string' ? rendered : '';
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

export function structuredPart(value: unknown, index: number): string | undefined {
  if (Array.isArray(value)) {
    const part = text((value as unknown[])[index]);
    return part ? part.trim() : undefined;
  }
  if (index === 0 && typeof value === 'string') {
    return text(value.split(';')[0]).trim() || undefined;
  }
  return undefined;
}

function parseVCardWithIcal(
  vCardData: string,
  accountId: string,
  addressBookId: string,
  url?: string,
  etag?: string,
): Contact {
  const component = new ICAL.Component(ICAL.parse(vCardData));

  const uid =
    firstStringValue(component.getFirstPropertyValue('uid')) ||
    filenameUid(url) ||
    uuidv4();

  const nameParts = component.getFirstPropertyValue('n');
  const lastName = structuredPart(nameParts, 0);
  const firstName = structuredPart(nameParts, 1);

  const displayName =
    text(component.getFirstPropertyValue('fn')) ||
    `${firstName ?? ''} ${lastName ?? ''}`.trim() ||
    'Unbenannt';

  const organization = text(component.getFirstPropertyValue('org'));

  const phones = component
    .getAllProperties('tel')
    .map((prop) => toContactField(prop))
    .filter((field): field is ContactField => field !== null);

  const emails = component
    .getAllProperties('email')
    .map((prop) => toContactField(prop))
    .filter((field): field is ContactField => field !== null);

  const addresses = component
    .getAllProperties('adr')
    .map((prop) => toContactAddress(prop))
    .filter((address): address is ContactAddress => address !== null);

  const bday = firstStringValue(component.getFirstPropertyValue('bday'));
  const birthday = parseBirthday(bday);

  const notes = text(component.getFirstPropertyValue('note')) || undefined;

  const photoProp = component.getFirstProperty('photo');
  const photoUrl = photoProp ? toPhotoUrl(photoProp) : undefined;

  return {
    id: uid,
    accountId,
    addressBookId,
    url: url ?? '',
    etag,
    displayName,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    organization: organization || undefined,
    phones,
    emails,
    addresses,
    birthday,
    notes,
    photoUrl,
    rawVCard: vCardData,
  };
}

function toContactField(prop: ICAL.Property): ContactField | null {
  const value = text(prop.getFirstValue());
  if (!value) {
    return null;
  }
  return { type: normalizeType(prop.getParameter('type')), value };
}

function toContactAddress(prop: ICAL.Property): ContactAddress | null {
  const value = prop.getFirstValue();
  const parts = Array.isArray(value)
    ? (value as unknown[]).map((part) => text(part))
    : [];
  const address: ContactAddress = {
    type: normalizeType(prop.getParameter('type')),
    street: parts[2] || undefined,
    city: parts[3] || undefined,
    postalCode: parts[5] || undefined,
    country: parts[6] || undefined,
  };
  return hasAddressContent(address) ? address : null;
}

function toPhotoUrl(prop: ICAL.Property): string | undefined {
  const raw = prop.getFirstValue();
  const value =
    raw && typeof raw === 'object' && 'value' in raw
      ? firstStringValue((raw as { value: unknown }).value)
      : firstStringValue(raw);
  return buildPhotoDataUri(value, firstStringValue(prop.getParameter('type')));
}

function text(value: unknown): string {
  return unescape(firstStringValue(value));
}

function unescape(value: string): string {
  const backslash = String.raw`\\`.charAt(0);
  return value
    .replaceAll(String.raw`\n`, '\n')
    .replaceAll(String.raw`\,`, ',')
    .replaceAll(String.raw`\;`, ';')
    .replaceAll(String.raw`\\`, backslash);
}

function typeFromParams(paramParts: string[]): string {
  for (const part of paramParts) {
    const match = /^type=(.+)$/i.exec(part);
    if (match) {
      return normalizeType(match[1].split(','));
    }
  }
  return 'other';
}

function parseBirthday(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const iso = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value);
  if (!iso) {
    return undefined;
  }
  const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function filenameUid(url?: string): string {
  if (!url) {
    return '';
  }
  return url.split('/').pop()?.replace(/\.vcf$/i, '') ?? '';
}

function hasAddressContent(address: ContactAddress): boolean {
  return Boolean(address.street || address.city || address.postalCode || address.country);
}
