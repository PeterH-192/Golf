import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { z } from 'zod';
import * as cors from 'cors';

admin.initializeApp();
const db = admin.firestore();
const corsHandler = cors({ origin: true });

// Helper to get UID from an Express request.
async function getUid(request: functions.https.Request): Promise<string | null> {
  const auth = request.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch (e) {
    return null;
  }
}

// Minimal callable to verify wiring (remains unchanged)
export const ping = functions.https.onCall(async (_data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  return { ok: true, uid: context.auth.uid, ts: Date.now() };
});

export const createRoom = functions.https.onRequest(async (request, response) => {
  corsHandler(request, response, async () => {
    try {
      const uid = await getUid(request);
      if (!uid) {
        response.status(401).send('Unauthorized');
        return;
      }

      const schema = z.object({ maxPlayers: z.number().min(2).max(6).default(4) });
      const { maxPlayers } = schema.parse(request.body ?? {});

      const ref = db.collection('rooms').doc();
      const inviteCode = ref.id.substring(0, 6).toUpperCase();

      await ref.set({
        status: 'waiting',
        rules: { acesHigh: false, kingsZero: false, pairsZero: false, powerUps: false, timerSec: 20 },
        ownerUid: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        maxPlayers,
        inviteCode,
        players: [{ uid, seat: 0, ready: false, online: true }],
        currentRoundId: null
      });

      response.send({ data: { roomId: ref.id, inviteCode } });
    } catch (e) {
      functions.logger.error('Error creating room:', e);
      if (e instanceof z.ZodError) {
        response.status(400).send({ error: { message: e.message }});
      } else {
        response.status(500).send({ error: { message: 'Internal server error' }});
      }
    }
  });
});

export const joinRoom = functions.https.onRequest(async (request, response) => {
  corsHandler(request, response, async () => {
    try {
      const uid = await getUid(request);
      if (!uid) {
        response.status(401).send('Unauthorized');
        return;
      }

      const { roomId } = z.object({ roomId: z.string().min(10) }).parse(request.body);
      const ref = db.collection('rooms').doc(roomId);
      const snap = await ref.get();

      if (!snap.exists) {
        response.status(404).send({ error: { message: 'Room not found' } });
        return;
      }

      const room = snap.data()!;
      if (room.status !== 'waiting') {
        response.status(412).send({ error: { message: 'Game already started' } }); // 412 Precondition Failed
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        response.status(429).send({ error: { message: 'Room full' } }); // 429 Too Many Requests (or other suitable code)
        return;
      }

      const already = room.players.some((p: any) => p.uid === uid);
      if (!already) {
        await ref.update({ players: admin.firestore.FieldValue.arrayUnion({ uid: uid, seat: room.players.length, ready: false, online: true }) });
      }

      response.send({ data: { ok: true } });
    } catch (e) {
      functions.logger.error('Error joining room:', e);
      if (e instanceof z.ZodError) {
        response.status(400).send({ error: { message: e.message }});
      } else {
        response.status(500).send({ error: { message: 'Internal server error' }});
      }
    }
  });
});
