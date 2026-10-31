// SPDX-License-Identifier: GPL-3.0-or-later
import { trimTrailingSlashes } from '../string/string.util';

export type SignalingState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'closed';

export interface SignalingIceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface SignalingSdpPayload {
  type: RTCSdpType;
  sdp?: string;
}

export interface SignalingInnerMessage {
  type?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  room?: string;
  sessionId?: string;
}

export interface SignalingEnvelope {
  type?: string;
  hello?: {
    version: string;
    auth: {
      url: string;
      userid: string;
      user: string;
      ticket: string;
    };
    token: string;
  };
  message?: SignalingInnerMessage;
}

export type SignalingAction =
  | { kind: 'set-remote'; description: RTCSessionDescriptionInit }
  | { kind: 'create-answer' }
  | { kind: 'add-candidate'; candidate: RTCIceCandidateInit };

function websocketScheme(serverUrl: string): 'ws' | 'wss' {
  return trimTrailingSlashes(serverUrl).startsWith('https://') ? 'wss' : 'ws';
}

/** Resolves a relative or absolute signaling WebSocket URL against the account origin. */
export function resolveWebSocketUrl(url: string, serverUrl: string): string {
  const scheme = websocketScheme(serverUrl);

  if (/^wss?:\/\//.test(url)) {
    const path = url.replace(/^wss?:\/\//, '');
    return `${scheme}://${path}`;
  }

  const base = trimTrailingSlashes(serverUrl);
  const wsBase = base.replace(/^http/, 'ws');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${wsBase}${path}`;
}

export function buildHelloEnvelope(
  serverUrl: string,
  username: string,
  authTicket: string,
  token: string,
): SignalingEnvelope {
  return {
    type: 'hello',
    hello: {
      version: '1.0',
      auth: {
        url: serverUrl,
        userid: username,
        user: username,
        ticket: authTicket,
      },
      token,
    },
  };
}

export function buildOfferEnvelope(
  token: string,
  sessionId: string,
  offer: RTCSessionDescriptionInit,
): SignalingEnvelope {
  return {
    type: 'message',
    message: {
      type: 'offer',
      offer: { type: offer.type, sdp: offer.sdp },
      room: token,
      sessionId,
    },
  };
}

export function buildAnswerEnvelope(
  token: string,
  sessionId: string,
  answer: RTCSessionDescriptionInit,
): SignalingEnvelope {
  return {
    type: 'message',
    message: {
      type: 'answer',
      answer: { type: answer.type, sdp: answer.sdp },
      room: token,
      sessionId,
    },
  };
}

export function buildCandidateEnvelope(
  token: string,
  sessionId: string,
  candidate: SignalingIceCandidate,
): SignalingEnvelope {
  return {
    type: 'message',
    message: {
      type: 'candidate',
      candidate,
      room: token,
      sessionId,
    },
  };
}

export function parseSignalingEnvelope(raw: string): SignalingEnvelope | null {
  try {
    return JSON.parse(raw) as SignalingEnvelope;
  } catch {
    return null;
  }
}

/** Maps an incoming signaling frame to peer-connection actions, or an empty list when ignorable. */
export function resolveSignalingActions(
  envelope: SignalingEnvelope,
): SignalingAction[] {
  if (envelope.type !== 'message' || !envelope.message) {
    return [];
  }

  const { message } = envelope;
  if (message.type === 'answer' && message.answer) {
    return [{ kind: 'set-remote', description: message.answer }];
  }
  if (message.type === 'offer' && message.offer) {
    return [
      { kind: 'set-remote', description: message.offer },
      { kind: 'create-answer' },
    ];
  }
  if (message.type === 'candidate' && message.candidate) {
    return [{ kind: 'add-candidate', candidate: message.candidate }];
  }

  return [];
}

export function toIceCandidatePayload(
  candidate: RTCIceCandidate,
): SignalingIceCandidate | null {
  if (!candidate.candidate) {
    return null;
  }
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
}
