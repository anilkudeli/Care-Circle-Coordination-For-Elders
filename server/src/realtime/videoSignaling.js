import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const invitationInput = z.object({
  callId: z.string().uuid(),
  seniorId: objectId,
  targetUserId: objectId,
}).strict();
const callInput = z.object({ callId: z.string().uuid() }).strict();
const signalInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('offer'),
    description: z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(100000) }).strict(),
  }).strict(),
  z.object({
    type: z.literal('answer'),
    description: z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(100000) }).strict(),
  }).strict(),
  z.object({
    type: z.literal('candidate'),
    candidate: z.object({
      candidate: z.string().max(4096),
      sdpMid: z.string().max(256).nullable().optional(),
      sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }).strict(),
  }).strict(),
]);

function acknowledge(callback, result) {
  if (typeof callback === 'function') callback(result);
}

function userId(user) {
  return String(user._id);
}

function hasSeniorAccess(user, seniorId) {
  return userId(user) === seniorId || user.seniorIds?.some((id) => String(id) === seniorId);
}

export function createVideoSignaling(io, User) {
  const calls = new Map();
  const userCalls = new Map();

  function participantSocket(call, id) {
    if (id === call.callerId) return call.callerSocketId;
    if (id === call.calleeId) return call.calleeSocketId;
    return null;
  }

  function releaseCall(call, event, payload = {}) {
    if (calls.get(call.callId) !== call) return;
    clearTimeout(call.expiryTimer);
    calls.delete(call.callId);
    if (userCalls.get(call.callerId) === call.callId) userCalls.delete(call.callerId);
    if (userCalls.get(call.calleeId) === call.callId) userCalls.delete(call.calleeId);
    if (event) {
      const message = { callId: call.callId, ...payload };
      io.to(call.callerId).emit(event, message);
      io.to(call.calleeId).emit(event, message);
    }
  }

  function attach(socket) {
    const callerId = userId(socket.user);

    socket.on('video:invite', async (data, callback) => {
      const parsed = invitationInput.safeParse(data);
      if (!parsed.success) return acknowledge(callback, { ok: false, error: 'Invalid call invitation.' });
      const { callId, seniorId, targetUserId } = parsed.data;
      if (callerId === targetUserId) return acknowledge(callback, { ok: false, error: 'You cannot call yourself.' });
      if (!hasSeniorAccess(socket.user, seniorId)) {
        return acknowledge(callback, { ok: false, error: 'You are not connected to that senior.' });
      }
      if (calls.has(callId)) return acknowledge(callback, { ok: false, error: 'This call invitation already exists.' });
      if (userCalls.has(callerId)) return acknowledge(callback, { ok: false, error: 'You are already in a call.' });
      if (userCalls.has(targetUserId)) return acknowledge(callback, { ok: false, error: 'This person is already in another call.' });

      try {
        const target = await User.findById(targetUserId).select('_id name role seniorIds');
        if (!target || !hasSeniorAccess(target, seniorId)) {
          return acknowledge(callback, { ok: false, error: 'The selected participant is not in this care circle.' });
        }
        const onlineSockets = await io.in(targetUserId).fetchSockets();
        if (!onlineSockets.length) return acknowledge(callback, { ok: false, error: 'This person is offline. Ask them to sign in before calling.' });

        const call = {
          callId,
          seniorId,
          callerId,
          callerName: socket.user.name,
          callerRole: socket.user.role,
          callerSocketId: socket.id,
          calleeId: targetUserId,
          calleeName: target.name,
          calleeSocketId: null,
          state: 'ringing',
          expiryTimer: null,
        };
        calls.set(callId, call);
        userCalls.set(callerId, callId);
        userCalls.set(targetUserId, callId);
        call.expiryTimer = setTimeout(() => {
          releaseCall(call, 'video:ended', { reason: 'timeout' });
        }, 45000);
        call.expiryTimer.unref?.();
        io.to(targetUserId).emit('video:incoming', {
          callId, seniorId, from: callerId, name: call.callerName, role: call.callerRole,
        });
        acknowledge(callback, { ok: true, callId });
      } catch (error) {
        console.error('Video invitation failed', { name: error.name, code: error.code });
        acknowledge(callback, { ok: false, error: 'The call invitation could not be delivered. Please try again.' });
      }
    });

    socket.on('video:accept', (data, callback) => {
      const parsed = callInput.safeParse(data);
      const call = parsed.success ? calls.get(parsed.data.callId) : null;
      if (!call || call.state !== 'ringing' || call.calleeId !== callerId) {
        return acknowledge(callback, { ok: false, error: 'This incoming call is no longer available.' });
      }
      call.state = 'accepted';
      call.calleeSocketId = socket.id;
      clearTimeout(call.expiryTimer);
      io.to(call.callerId).emit('video:accepted', { callId: call.callId, from: callerId });
      acknowledge(callback, { ok: true, callId: call.callId });
    });

    socket.on('video:reject', (data, callback) => {
      const parsed = callInput.safeParse(data);
      const call = parsed.success ? calls.get(parsed.data.callId) : null;
      if (!call || call.state !== 'ringing' || call.calleeId !== callerId) {
        return acknowledge(callback, { ok: false, error: 'This incoming call is no longer available.' });
      }
      releaseCall(call, 'video:rejected', { by: callerId });
      acknowledge(callback, { ok: true });
    });

    socket.on('video:signal', (data, callback) => {
      const parsed = z.object({ callId: z.string().uuid(), signal: signalInput }).strict().safeParse(data);
      const call = parsed.success ? calls.get(parsed.data.callId) : null;
      const senderSocket = call && participantSocket(call, callerId);
      if (!call || call.state !== 'accepted' || senderSocket !== socket.id) {
        return acknowledge(callback, { ok: false, error: 'The call is not active. Rejoin or start a new call.' });
      }
      const targetUserId = callerId === call.callerId ? call.calleeId : call.callerId;
      io.to(targetUserId).emit('video:signal', {
        callId: call.callId, from: callerId, signal: parsed.data.signal,
      });
      acknowledge(callback, { ok: true });
    });

    socket.on('video:end', (data, callback) => {
      const parsed = callInput.safeParse(data);
      const call = parsed.success ? calls.get(parsed.data.callId) : null;
      if (!call || participantSocket(call, callerId) !== socket.id) {
        return acknowledge(callback, { ok: false, error: 'This call is no longer active.' });
      }
      releaseCall(call, 'video:ended', { by: callerId, reason: 'ended' });
      acknowledge(callback, { ok: true });
    });

    socket.on('disconnect', () => {
      for (const callId of [userCalls.get(callerId)]) {
        const call = calls.get(callId);
        if (call && participantSocket(call, callerId) === socket.id) {
          releaseCall(call, 'video:ended', { by: callerId, reason: 'disconnected' });
        } else if (call?.state === 'ringing' && call.callerSocketId === socket.id) {
          releaseCall(call, 'video:ended', { by: callerId, reason: 'disconnected' });
        }
      }
    });
  }

  return { attach, activeCallCount: () => calls.size };
}
