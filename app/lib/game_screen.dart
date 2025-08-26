import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'models.dart';
import 'card_widget.dart';

class GameScreen extends StatefulWidget {
  final String roomId;

  const GameScreen({super.key, required this.roomId});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final functions = FirebaseFunctions.instance;

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser!.uid;
    final roomRef = FirebaseFirestore.instance.collection('rooms').doc(widget.roomId);

    return Scaffold(
      appBar: AppBar(title: Text('Game Room: ${widget.roomId}')),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: roomRef.snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final roomData = snapshot.data!.data();
          if (roomData == null) return const Center(child: Text('Room not found.'));

          final game = Game.fromFirestore(snapshot.data!.id, roomData);
          final me = game.players.firstWhere((p) => p.uid == uid);
          final isMyTurn = game.currentTurn == uid;

          if (game.status == 'round_over') {
            return _buildScores(context, game);
          }

          return Column(
            children: [
              _buildOpponentHands(context, game.players.where((p) => p.uid != uid).toList()),
              Expanded(
                child: Center(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      CardWidget(
                        card: Card(Suit.joker, Rank.joker)..isFaceUp = false,
                        onTap: isMyTurn && me.drawnCard == null ? () => _drawCard('deck') : null,
                      ),
                      game.discardPile.isNotEmpty
                          ? CardWidget(
                              card: game.discardPile.last,
                              onTap: isMyTurn && me.drawnCard == null ? () => _drawCard('discard') : null,
                            )
                          : Container(width: 80, height: 120, decoration: BoxDecoration(border: Border.all())),
                    ],
                  ),
                ),
              ),
              if (me.drawnCard != null)
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text("Drawn Card:"),
                    const SizedBox(width: 10),
                    CardWidget(card: me.drawnCard!),
                    const SizedBox(width: 10),
                    ElevatedButton(onPressed: _discard, child: const Text("Discard")),
                  ],
                ),
              _buildPlayerHand(context, me, isMyTurn),
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Text(
                  isMyTurn ? "Your Turn" : "Waiting for player...",
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              if (isMyTurn && me.drawnCard == null)
                ElevatedButton(
                  onPressed: () => functions.httpsCallable('knock').call({'roomId': widget.roomId}),
                  child: const Text('Knock'),
                ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _drawCard(String from) async {
    await functions.httpsCallable('drawCard').call({'roomId': widget.roomId, 'from': from});
  }

  Future<void> _swapCard(int handIndex) async {
    await functions.httpsCallable('swapCard').call({'roomId': widget.roomId, 'handIndex': handIndex});
  }

  Future<void> _discard() async {
    await functions.httpsCallable('discard').call({'roomId': widget.roomId});
  }

  Widget _buildPlayerHand(BuildContext context, Player player, bool isMyTurn) {
    // At the start of the game, players can look at their bottom two cards.
    // This logic should be improved to reflect that. For now, all cards are face up for the current player.
    for (var card in player.hand) {
      card.isFaceUp = true;
    }

    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        children: [
          Text('Your Hand', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CardWidget(card: player.hand[0], onTap: isMyTurn && player.drawnCard != null ? () => _swapCard(0) : null),
              const SizedBox(width: 8),
              CardWidget(card: player.hand[1], onTap: isMyTurn && player.drawnCard != null ? () => _swapCard(1) : null),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CardWidget(card: player.hand[2], onTap: isMyTurn && player.drawnCard != null ? () => _swapCard(2) : null),
              const SizedBox(width: 8),
              CardWidget(card: player.hand[3], onTap: isMyTurn && player.drawnCard != null ? () => _swapCard(3) : null),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildOpponentHands(BuildContext context, List<Player> opponents) {
    return Padding(
      padding: const EdgeInsets.all(8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: opponents.map((opponent) {
          return Column(
            children: [
              Text('Player ${opponent.seat + 1}'),
              const SizedBox(height: 4),
              Row(
                children: [
                  CardWidget(card: opponent.hand[0]),
                  const SizedBox(width: 4),
                  CardWidget(card: opponent.hand[1]),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  CardWidget(card: opponent.hand[2]),
                  const SizedBox(width: 4),
                  CardWidget(card: opponent.hand[3]),
                ],
              )
            ],
          );
        }).toList(),
      ),
    );
  }

  Widget _buildScores(BuildContext context, Game game) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Round Over!', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 20),
          ...game.players.map((p) {
            return Text('Player ${p.seat + 1}: ${game.scores[p.uid]}', style: Theme.of(context).textTheme.titleLarge);
          }),
          const SizedBox(height: 20),
          if (game.ownerUid == FirebaseAuth.instance.currentUser!.uid)
            ElevatedButton(
              onPressed: () => functions.httpsCallable('startGame').call({'roomId': widget.roomId}),
              child: const Text('Next Round'),
            )
        ],
      ),
    );
  }
}
