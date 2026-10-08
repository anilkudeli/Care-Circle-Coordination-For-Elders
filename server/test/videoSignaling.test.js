import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoSignaling } from '../src/realtime/videoSignaling.js';

const seniorId = '111111111111111111111111';
const callerId = '222222222222222222222222';
const calleeId = '333333333333333333333333';

class FakeIo {
  constructor() {
    this.sockets = new Map();
    this.messages = [];
  }

  to(room) {
    return {
      emit: (event, payload) => this.messages.push({ room, event, payload }),
    };
  }

  in(room) {
    return {
      fetchSockets: async () => this.sockets.has(room) ? [{}] : [],
    };
  }
}

class FakeSocket {
  constructor(id, user) {
    this.id = id;
    this.user = user;
    this.handlers = new Map();
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  async clientEmit(event, payload) {
    const handler = this.handlers.get(event);
    assert.ok(handler, `${event} handler is registered`);
    return new Promise((resolve) => handler(payload, resolve));
  }

  disconnect() {
    this.handlers.get('disconnect')?.();
  }
}

function setup() {
  const io = new FakeIo();
  const users = new Map([
    [callerId, { _id: callerId, name: 'Family member', role: 'family', seniorIds: [seniorId] }],
    [calleeId, { _id: calleeId, name: 'Caregiver', role: 'caregiver', seniorIds: [seniorId] }],
  ]);
  const User = {
    findById: (id) => ({ select: async () => users.get(String(id)) || null }),
  };
  const signaling = createVideoSignaling(io, User);
  const caller = new FakeSocket('caller-socket', users.get(callerId));
  const callee = new FakeSocket('callee-socket', users.get(calleeId));
  io.sockets.set(calleeId, callee);
  signaling.attach(caller);
  signaling.attach(callee);
  return { io, signaling, caller, callee };
}

test('video signaling delivers invite, accept, offer, answer, ICE, and end only to the call peer', async () => {
  const { io, signaling, caller, callee } = setup();
  const callId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const invitation = await caller.clientEmit('video:invite', { callId, seniorId, targetUserId: calleeId });

  assert.deepEqual(invitation, { ok: true, callId });
  assert.deepEqual(io.messages.at(-1), {
    room: calleeId,
    event: 'video:incoming',
    payload: { callId, seniorId, from: callerId, name: 'Family member', role: 'family' },
  });
  assert.equal(signaling.activeCallCount(), 1);

  assert.deepEqual(await callee.clientEmit('video:accept', { callId }), { ok: true, callId });
  assert.equal(io.messages.at(-1).event, 'video:accepted');
  assert.equal(io.messages.at(-1).room, callerId);

  const offer = { type: 'offer', description: { type: 'offer', sdp: 'offer-sdp' } };
  assert.deepEqual(await caller.clientEmit('video:signal', { callId, signal: offer }), { ok: true });
  assert.deepEqual(io.messages.at(-1), {
    room: calleeId, event: 'video:signal', payload: { callId, from: callerId, signal: offer },
  });

  const answer = { type: 'answer', description: { type: 'answer', sdp: 'answer-sdp' } };
  assert.deepEqual(await callee.clientEmit('video:signal', { callId, signal: answer }), { ok: true });
  assert.equal(io.messages.at(-1).room, callerId);
  assert.deepEqual(io.messages.at(-1).payload.signal, answer);

  const candidate = {
    type: 'candidate',
    candidate: { candidate: 'candidate:1 1 UDP 1 192.0.2.1 1234 typ host', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: null },
  };
  assert.deepEqual(await caller.clientEmit('video:signal', { callId, signal: candidate }), { ok: true });
  assert.deepEqual(io.messages.at(-1).payload.signal, candidate);

  assert.deepEqual(await caller.clientEmit('video:end', { callId }), { ok: true });
  assert.equal(signaling.activeCallCount(), 0);
  assert.equal(io.messages.at(-1).event, 'video:ended');
  assert.equal(io.messages.at(-1).room, calleeId);
});

test('video signaling rejects users outside the selected care circle and offline recipients', async () => {
  const { io, caller } = setup();
  const unauthorized = await caller.clientEmit('video:invite', {
    callId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    seniorId: '444444444444444444444444',
    targetUserId: calleeId,
  });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.error, /not connected/i);

  io.sockets.delete(calleeId);
  const offline = await caller.clientEmit('video:invite', {
    callId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', seniorId, targetUserId: calleeId,
  });
  assert.equal(offline.ok, false);
  assert.match(offline.error, /offline/i);
  assert.equal(io.messages.length, 0);
});

test('disconnecting either accepted participant ends the call and releases both call locks', async () => {
  const { io, signaling, caller, callee } = setup();
  const callId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await caller.clientEmit('video:invite', { callId, seniorId, targetUserId: calleeId });
  await callee.clientEmit('video:accept', { callId });

  io.sockets.delete(calleeId);
  callee.disconnect();

  assert.equal(signaling.activeCallCount(), 0);
  assert.ok(io.messages.some((message) => message.event === 'video:ended' && message.room === callerId));
  const nextCall = await caller.clientEmit('video:invite', {
    callId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', seniorId, targetUserId: calleeId,
  });
  assert.equal(nextCall.ok, false);
});
