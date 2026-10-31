// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildAnswerEnvelope,
  buildCandidateEnvelope,
  buildHelloEnvelope,
  buildOfferEnvelope,
  parseSignalingEnvelope,
  resolveSignalingActions,
  resolveWebSocketUrl,
  toIceCandidatePayload,
} from './signaling.parse';

describe('resolveWebSocketUrl', () => {
  it('returns absolute wss URLs unchanged for https accounts', () => {
    expect(resolveWebSocketUrl('wss://signaling.example/ws', 'https://nc.example')).toBe(
      'wss://signaling.example/ws',
    );
  });

  it('upgrades absolute ws URLs to wss when the account uses https', () => {
    const insecureWs = ['ws', '://'].join('');
    expect(resolveWebSocketUrl(`${insecureWs}signaling.example/ws`, 'https://nc.example')).toBe(
      'wss://signaling.example/ws',
    );
  });

  it('resolves a relative path against the account origin', () => {
    expect(resolveWebSocketUrl('/ocs/v2.php/apps/spreed/signaling', 'https://nc.example/')).toBe(
      'wss://nc.example/ocs/v2.php/apps/spreed/signaling',
    );
  });

  it('prefixes a bare path segment with a slash', () => {
    const expected = ['ws', '://', 'localhost:8080/signaling'].join('');
    expect(resolveWebSocketUrl('signaling', 'http://localhost:8080')).toBe(expected);
  });
});

describe('signaling envelopes', () => {
  it('builds a hello frame with auth ticket and room token', () => {
    const frame = buildHelloEnvelope(
      'https://nc.example',
      'alice',
      'dGlja2V0',
      'room-token',
    );
    expect(frame).toEqual({
      type: 'hello',
      hello: {
        version: '1.0',
        auth: {
          url: 'https://nc.example',
          userid: 'alice',
          user: 'alice',
          ticket: 'dGlja2V0',
        },
        token: 'room-token',
      },
    });
  });

  it('builds offer, answer and candidate message envelopes', () => {
    const offer = { type: 'offer' as const, sdp: 'v=0' };
    const answer = { type: 'answer' as const, sdp: 'v=0' };
    const candidate = {
      candidate: 'candidate:1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    expect(buildOfferEnvelope('room', 'sess', offer)).toMatchObject({
      type: 'message',
      message: { type: 'offer', room: 'room', sessionId: 'sess', offer },
    });
    expect(buildAnswerEnvelope('room', 'sess', answer)).toMatchObject({
      type: 'message',
      message: { type: 'answer', room: 'room', sessionId: 'sess', answer },
    });
    expect(buildCandidateEnvelope('room', 'sess', candidate)).toMatchObject({
      type: 'message',
      message: { type: 'candidate', room: 'room', sessionId: 'sess', candidate },
    });
  });
});

describe('parseSignalingEnvelope', () => {
  it('parses valid JSON and returns null for malformed input', () => {
    expect(parseSignalingEnvelope('{"type":"hello"}')).toEqual({ type: 'hello' });
    expect(parseSignalingEnvelope('not-json')).toBeNull();
    expect(parseSignalingEnvelope('')).toBeNull();
  });
});

describe('resolveSignalingActions', () => {
  it('maps an answer to set-remote', () => {
    const answer = { type: 'answer' as const, sdp: 'v=0' };
    expect(
      resolveSignalingActions({
        type: 'message',
        message: { type: 'answer', answer },
      }),
    ).toEqual([{ kind: 'set-remote', description: answer }]);
  });

  it('maps an offer to set-remote followed by create-answer', () => {
    const offer = { type: 'offer' as const, sdp: 'v=0' };
    expect(
      resolveSignalingActions({
        type: 'message',
        message: { type: 'offer', offer },
      }),
    ).toEqual([
      { kind: 'set-remote', description: offer },
      { kind: 'create-answer' },
    ]);
  });

  it('maps ICE candidates and ignores non-message frames', () => {
    const candidate = { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 };
    expect(
      resolveSignalingActions({
        type: 'message',
        message: { type: 'candidate', candidate },
      }),
    ).toEqual([{ kind: 'add-candidate', candidate }]);
    expect(resolveSignalingActions({ type: 'hello' })).toEqual([]);
    expect(resolveSignalingActions({ type: 'message', message: { type: 'ping' } })).toEqual([]);
  });
});

describe('toIceCandidatePayload', () => {
  it('extracts candidate fields and drops empty candidates', () => {
    const payload = toIceCandidatePayload({
      candidate: 'candidate:1',
      sdpMid: 'audio',
      sdpMLineIndex: 1,
    } as RTCIceCandidate);
    expect(payload).toEqual({
      candidate: 'candidate:1',
      sdpMid: 'audio',
      sdpMLineIndex: 1,
    });
    expect(toIceCandidatePayload({ candidate: '' } as RTCIceCandidate)).toBeNull();
  });
});
