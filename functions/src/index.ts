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

export const setReady = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId, ready } = z.object({ roomId: z.string().min(10), ready: z.boolean() }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  assert(room.status === 'waiting', 'failed-precondition', 'Game already started');
  const player = room.players.find((p:any) => p.uid === context.auth!.uid);
  if (!player) throw new functions.https.HttpsError('not-found', 'Player not in room');
  player.ready = ready;
  await ref.update({ players: room.players });
  return { ok: true };
});

export const startGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string().min(10) }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  assert(room.ownerUid === context.auth.uid, 'permission-denied', 'Only owner can start');
  assert(room.status === 'waiting', 'failed-precondition', 'Game already started');
  assert(room.players.length >= 2, 'failed-precondition', 'Need at least 2 players');
  assert(room.players.every((p:any) => p.ready), 'failed-precondition', 'All players must be ready');

  const deck = createDeck();
  shuffleDeck(deck);

  const hands = room.players.map(() => deck.splice(0, 6));
  const discard = deck.splice(0, 1);

  await ref.update({
    status: 'playing',
    turn: 0,
    deck,
    discard,
    hands,
  });

  return { ok: true };
});

// --- Helpers ---
const SUITS = ['C', 'D', 'H', 'S'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

function createDeck() {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffleDeck(deck:any[]) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

export const drawFromDeck = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string().min(10) }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  const player = room.players[room.turn];
  assert(player.uid === context.auth!.uid, 'permission-denied', 'Not your turn');
  assert(room.status === 'playing', 'failed-precondition', 'Game not started');
  assert(room.deck.length > 0, 'failed-precondition', 'Deck is empty');

  const card = room.deck.pop();
  room.hands[room.turn].push(card);

  await ref.update({
    deck: room.deck,
    hands: room.hands,
  });

  return { ok: true };
});

export const drawFromDiscard = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string().min(10) }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  const player = room.players[room.turn];
  assert(player.uid === context.auth!.uid, 'permission-denied', 'Not your turn');
  assert(room.status === 'playing', 'failed-precondition', 'Game not started');
  assert(room.discard.length > 0, 'failed-precondition', 'Discard pile is empty');

  const card = room.discard.pop();
  room.hands[room.turn].push(card);

  await ref.update({
    discard: room.discard,
    hands: room.hands,
  });

  return { ok: true };
});

export const discardCard = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId, card } = z.object({ roomId: z.string().min(10), card: z.string() }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  const player = room.players[room.turn];
  assert(player.uid === context.auth!.uid, 'permission-denied', 'Not your turn');
  assert(room.status === 'playing', 'failed-precondition', 'Game not started');

  const hand = room.hands[room.turn];
  const cardIndex = hand.indexOf(card);
  assert(cardIndex !== -1, 'failed-precondition', 'Card not in hand');

  hand.splice(cardIndex, 1);
  room.discard.push(card);

  await ref.update({
    hands: room.hands,
    discard: room.discard,
  });

  return { ok: true };
});

export const endTurn = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string().min(10) }).parse(data);
  const ref = db.collection('rooms').doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  const room = snap.data()!;
  const player = room.players[room.turn];
  assert(player.uid === context.auth!.uid, 'permission-denied', 'Not your turn');
  assert(room.status === 'playing', 'failed-precondition', 'Game not started');

  await ref.update({
    turn: (room.turn + 1) % room.players.length,
  });

  return { ok: true };
});
