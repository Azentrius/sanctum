// SPDX-License-Identifier: GPL-3.0-or-later
import { registerPlugin } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';

export interface CertPinEntry {
  host: string;
  hashes: string[];
}

export interface CertPinCaptureResult {
  hashes: string[];
}

export interface CertPinPlugin {
  syncPins(options: { pins: CertPinEntry[] }): Promise<void>;
  capturePin(options: { url: string }): Promise<CertPinCaptureResult>;
  request(options: HttpOptions): Promise<HttpResponse>;
}

export const CertPin = registerPlugin<CertPinPlugin>('CertPin');
