import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { z } from 'zod';

admin.initializeApp();
const db = admin.firestore();

function assert(cond: boolean, code: functions.https.FunctionsErrorCode, msg: string): asserts cond {
  if (!cond) throw new functions.https.HttpsError(code, msg);
}

// Minimal callable to verify wiring
export const ping = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  return { ok: true, uid: context.auth.uid, ts: Date.now() };
});

export const createRoom = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const uid = context.auth.uid;
  const schema = z.object({ maxPlayers: z.number().min(2).max(6).default(4) });
  const { maxPlayers } = schema.parse(data ?? {});

  const ref = db.collection('rooms').doc();
  const inviteCode = ref.id.substring(0,6).toUpperCase();

  await ref.set({
    status: 'waiting',
    rules: { acesHigh:false, kingsZero:false, pairsZero:false, powerUps:false, timerSec:20 },
    ownerUid: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    maxPlayers,
    inviteCode,
    players: [{ uid, seat:0, ready:false, online:true }],
    currentRoundId: null
  });

  return { roomId: ref.id, inviteCode };
});

export const joinRoom = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string().min(10) }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  assert(room.status === 'waiting', 'failed-precondition', 'Game already started');
  assert(room.players.length < room.maxPlayers, 'resource-exhausted', 'Room full');
  const already = room.players.some((p:any)=> p.uid === context.auth!.uid);
  if (!already) {
    await ref.update({ players: admin.firestore.FieldValue.arrayUnion({ uid: context.auth!.uid, seat: room.players.length, ready:false, online:true }) });
  }
  return { ok: true };
});
