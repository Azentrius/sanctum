// SPDX-License-Identifier: GPL-3.0-or-later
import { v4 as uuidv4 } from 'uuid';

import { Contact, ContactAddress } from './contact.model';

export function contactToVCard(contact: Partial<Contact>): string {
  const uid = contact.id ?? uuidv4();
  const firstName = contact.firstName?.trim() ?? '';
  const lastName = contact.lastName?.trim() ?? '';
  const displayName =
    contact.displayName?.trim() || `${firstName} ${lastName}`.trim() || 'Unbenannt';

  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0', `UID:${escape(uid)}`];

  lines.push(
    `FN:${escape(displayName)}`,
    `N:${escape(lastName)};${escape(firstName)};;;`,
  );

  if (contact.organization?.trim()) {
    lines.push(`ORG:${escape(contact.organization.trim())}`);
  }

  for (const phone of contact.phones ?? []) {
    if (!phone.value?.trim()) {
      continue;
    }
    lines.push(`TEL;TYPE=${typeParam(phone.type)}:${escape(phone.value.trim())}`);
  }

  for (const email of contact.emails ?? []) {
    if (!email.value?.trim()) {
      continue;
    }
    lines.push(`EMAIL;TYPE=${typeParam(email.type)}:${escape(email.value.trim())}`);
  }

  for (const address of contact.addresses ?? []) {
    if (!hasAddressContent(address)) {
      continue;
    }
    const parts = [
      '',
      '',
      escape(address.street ?? ''),
      escape(address.city ?? ''),
      '',
      escape(address.postalCode ?? ''),
      escape(address.country ?? ''),
    ];
    lines.push(`ADR;TYPE=${typeParam(address.type)}:${parts.join(';')}`);
  }

  if (contact.birthday) {
    lines.push(`BDAY:${formatDateOnly(contact.birthday)}`);
  }
  if (contact.notes?.trim()) {
    lines.push(`NOTE:${escape(contact.notes.trim())}`);
  }
  if (contact.photoUrl?.startsWith('data:')) {
    lines.push(photoLineFromDataUri(contact.photoUrl));
  }

  lines.push(`REV:${formatUtcTimestamp(new Date())}`, 'END:VCARD');

  return `${lines.map((line) => foldLine(line)).join('\r\n')}\r\n`;
}

export function photoLineFromDataUri(dataUri: string): string {
  const match = /^data:(.*?);base64,(.*)$/s.exec(dataUri);
  if (!match) {
    return `PHOTO:${dataUri}`;
  }
  const type = match[1].replace('image/', '').toUpperCase();
  return `PHOTO;ENCODING=b;TYPE=${type}:${match[2]}`;
}

const BACKSLASH = String.raw`\\`.charAt(0);

export function escape(value: string): string {
  return value
    .replaceAll(BACKSLASH, String.raw`\\`)
    .replaceAll(';', String.raw`\;`)
    .replaceAll(',', String.raw`\,`)
    .replaceAll('\r\n', String.raw`\n`)
    .replaceAll('\n', String.raw`\n`);
}

export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      segments.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) {
    segments.push(current);
  }

  return segments.join('\r\n ');
}

function hasAddressContent(address: ContactAddress): boolean {
  return Boolean(address.street || address.city || address.postalCode || address.country);
}

function typeParam(type: string | undefined): string {
  const value = (type ?? 'other').trim().toUpperCase();
  return value.length > 0 ? value : 'OTHER';
}

function formatDateOnly(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatUtcTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
