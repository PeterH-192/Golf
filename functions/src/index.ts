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
  const { roomIdentifier } = z.object({ roomIdentifier: z.string().min(6) }).parse(data);

  let roomRef: admin.firestore.DocumentReference;
  let roomSnap: admin.firestore.DocumentSnapshot;

  if (roomIdentifier.length === 6) {
    const query = await db.collection('rooms').where('inviteCode', '==', roomIdentifier.toUpperCase()).limit(1).get();
    if (query.empty) throw new functions.https.HttpsError('not-found', 'Room not found');
    roomRef = query.docs[0].ref;
    roomSnap = query.docs[0];
  } else {
    roomRef = db.collection('rooms').doc(roomIdentifier);
    roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new functions.https.HttpsError('not-found', 'Room not found');
  }

  const room = roomSnap.data()!;
  assert(room.status === 'waiting', 'failed-precondition', 'Game already started');
  assert(room.players.length < room.maxPlayers, 'resource-exhausted', 'Room full');
  const already = room.players.some((p:any)=> p.uid === context.auth!.uid);
  if (!already) {
    await roomRef.update({ players: admin.firestore.FieldValue.arrayUnion({ uid: context.auth!.uid, seat: room.players.length, ready:false, online:true }) });
  }
  return { roomId: roomRef.id };
});

export const startGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string() }).parse(data);
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  assert(!!room, 'not-found', 'Room not found');
  assert(room.ownerUid === context.auth.uid, 'permission-denied', 'Only owner can start');
  assert(room.status === 'waiting' || room.status === 'round_over', 'failed-precondition', 'Game already started');
  assert(room.players.every((p: any) => p.ready), 'failed-precondition', 'All players must be ready');

  const suits = [0, 1, 2, 3]; // clubs, diamonds, hearts, spades
  const ranks = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]; // ace -> king
  let deck: any[] = suits.flatMap(suit => ranks.map(rank => ({ suit, rank, isFaceUp: false })));
  deck = [...deck, ...deck]; // 2 decks
  deck.push({ suit: 4, rank: 13, isFaceUp: false }); // 4 jokers
  deck.push({ suit: 4, rank: 13, isFaceUp: false });
  deck.push({ suit: 4, rank: 13, isFaceUp: false });
  deck.push({ suit: 4, rank: 13, isFaceUp: false });

  // Shuffle deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const players = room.players.map((p: any) => {
    p.hand = deck.splice(0, 4);
    delete p.drawnCard;
    return p;
  });

  const discardPile = deck.splice(0, 1);
  discardPile[0].isFaceUp = true;

  await roomRef.update({
    status: 'playing',
    deck,
    discardPile,
    players,
    currentTurn: room.players[0].uid,
    turnEndsAt: Date.now() + (room.rules.timerSec * 1000),
    knockerUid: null,
    scores: {},
  });
});

export const drawCard = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId, from } = z.object({ roomId: z.string(), from: z.enum(['deck', 'discard']) }).parse(data);
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  assert(!!room, 'not-found', 'Room not found');
  assert(room.currentTurn === context.auth.uid, 'failed-precondition', 'Not your turn');
  const player = room.players.find((p: any) => p.uid === context.auth!.uid);
  assert(!player.drawnCard, 'failed-precondition', 'You have already drawn a card.');


  let card;
  let updateData: any = {};
  if (from === 'deck') {
    assert(room.deck.length > 0, 'failed-precondition', 'Deck is empty');
    card = room.deck.pop();
    updateData.deck = room.deck;
  } else {
    assert(room.discardPile.length > 0, 'failed-precondition', 'Discard pile is empty');
    card = room.discardPile.pop();
    updateData.discardPile = room.discardPile;
  }
  card.isFaceUp = true;

  const players = room.players.map((p: any) => {
    if (p.uid === context.auth!.uid) {
      p.drawnCard = card;
    }
    return p;
  });
  updateData.players = players;

  await roomRef.update(updateData);
});

async function endTurn(roomId: string, uid: string) {
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  if (!room) return;

  const playerIndex = room.players.findIndex((p: any) => p.uid === uid);
  const nextPlayerIndex = (playerIndex + 1) % room.players.length;
  const nextPlayer = room.players[nextPlayerIndex];

  if (room.knockerUid && room.knockerUid === nextPlayer.uid) {
    // Round is over, calculate scores
    await calculateScoresInternal(roomId);
  } else {
    await roomRef.update({
      currentTurn: nextPlayer.uid,
      turnEndsAt: Date.now() + (room.rules.timerSec * 1000),
    });
  }
}

export const discard = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string() }).parse(data);
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  assert(!!room, 'not-found', 'Room not found');
  assert(room.currentTurn === context.auth!.uid, 'failed-precondition', 'Not your turn');

  const playerIndex = room.players.findIndex((p: any) => p.uid === context.auth!.uid);
  const player = room.players[playerIndex];
  assert(!!player.drawnCard, 'failed-precondition', 'No card to discard');

  const cardToDiscard = player.drawnCard;
  delete player.drawnCard;

  await roomRef.update({
    players: room.players,
    discardPile: admin.firestore.FieldValue.arrayUnion(cardToDiscard),
  });

  await endTurn(roomId, context.auth.uid);
});

export const swapCard = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId, handIndex } = z.object({ roomId: z.string(), handIndex: z.number().min(0).max(3) }).parse(data);
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  assert(!!room, 'not-found', 'Room not found');
  assert(room.currentTurn === context.auth!.uid, 'failed-precondition', 'Not your turn');

  const playerIndex = room.players.findIndex((p: any) => p.uid === context.auth!.uid);
  const player = room.players[playerIndex];
  assert(!!player.drawnCard, 'failed-precondition', 'No card drawn');

  const newDiscard = player.hand[handIndex];
  player.hand[handIndex] = player.drawnCard;
  delete player.drawnCard;

  await roomRef.update({
    players: room.players,
    discardPile: admin.firestore.FieldValue.arrayUnion(newDiscard),
  });

  await endTurn(roomId, context.auth.uid);
});

export const knock = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string() }).parse(data);
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  assert(!!room, 'not-found', 'Room not found');
  assert(room.currentTurn === context.auth!.uid, 'failed-precondition', 'Not your turn');
  assert(!room.knockerUid, 'failed-precondition', 'Someone has already knocked');

  await roomRef.update({
    knockerUid: context.auth.uid,
  });

  await endTurn(roomId, context.auth.uid);
});

async function calculateScoresInternal(roomId: string) {
  const roomRef = db.collection('rooms').doc(roomId);
  const room = (await roomRef.get()).data();
  if (!room) return;

  const scores: any = {};
  room.players.forEach((p: any) => {
    let score = 0;
    const col1 = [p.hand[0], p.hand[2]];
    const col2 = [p.hand[1], p.hand[3]];

    const scoreCol = (col: any[]) => {
      if (col[0].rank === col[1].rank) return 0;
      return col.reduce((acc: number, card: any) => {
        if (card.rank === 12) return acc + 0; // King
        if (card.rank === 0) return acc + 1; // Ace
        if (card.rank === 1) return acc - 2; // 2
        if (card.rank === 13) return acc - 5; // Joker
        if (card.rank >= 9 && card.rank <= 11) return acc + 10; // J, Q
        return acc + card.rank + 1;
      }, 0);
    }

    score += scoreCol(col1);
    score += scoreCol(col2);
    scores[p.uid] = score;
  });

  const players = room.players.map((p: any) => {
    p.hand.forEach((c: any) => c.isFaceUp = true);
    return p;
  });

  await roomRef.update({
    status: 'round_over',
    scores,
    players,
  });
}

export const calculateScores = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const { roomId } = z.object({ roomId: z.string() }).parse(data);
  await calculateScoresInternal(roomId);
});
