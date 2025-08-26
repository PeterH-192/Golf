import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'models.dart';
import 'game_screen.dart';

class RoomScreen extends StatelessWidget {
  final String roomId;

  const RoomScreen({super.key, required this.roomId});

  @override
  Widget build(BuildContext context) {
    final firestore = FirebaseFirestore.instance;
    final functions = FirebaseFunctions.instance;
    final roomRef = firestore.collection('rooms').doc(roomId);
    final uid = FirebaseAuth.instance.currentUser!.uid;

    return Scaffold(
      appBar: AppBar(
        title: Text('Room: $roomId'),
      ),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: roomRef.snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.active) {
            if (snapshot.hasData && snapshot.data!.exists) {
              final roomData = snapshot.data!.data()!;
              final game = Game.fromFirestore(snapshot.data!.id, roomData);

              // Navigate to GameScreen if game is already playing
              if (game.status == 'playing') {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute(builder: (_) => GameScreen(roomId: roomId)),
                  );
                });
                return const Center(child: CircularProgressIndicator());
              }

              final me = game.players.firstWhere((p) => p.uid == uid, orElse: () => Player(uid: uid, seat: -1, ready: false, online: false, hand: []));
              final allReady = game.players.isNotEmpty && game.players.every((p) => p.ready);

              return Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SelectableText('Invite Code: ${roomData['inviteCode'] ?? '...'}', style: Theme.of(context).textTheme.headlineSmall),
                    const SizedBox(height: 20),
                    Text('Players:', style: Theme.of(context).textTheme.titleLarge),
                    Expanded(
                      child: ListView.builder(
                        itemCount: game.players.length,
                        itemBuilder: (context, index) {
                          final player = game.players[index];
                          return ListTile(
                            leading: CircleAvatar(child: Text('${player.seat + 1}')),
                            title: Text('Player ${player.seat + 1} ${player.uid == uid ? "(You)" : ""}'),
                            trailing: Text(player.ready ? 'Ready' : 'Not Ready', style: TextStyle(color: player.ready ? Colors.green : Colors.red)),
                          );
                        },
                      ),
                    ),
                    if (me.seat != -1)
                      ElevatedButton(
                        onPressed: () async {
                          final updatedPlayers = game.players.map((p) {
                            if (p.uid == uid) {
                              return p.copyWith(ready: !p.ready);
                            }
                            return p;
                          }).toList();
                          await roomRef.update({'players': updatedPlayers.map((p) => p.toJson()).toList()});
                        },
                        child: Text(me.ready ? 'Set Not Ready' : 'Set Ready'),
                      ),
                    if (game.ownerUid == uid)
                      ElevatedButton(
                        onPressed: allReady ? () async {
                          await functions.httpsCallable('startGame').call({'roomId': roomId});
                        } : null,
                        child: const Text('Start Game'),
                      ),
                  ],
                ),
              );
            } else {
              return const Center(child: Text('Room not found.'));
            }
          }
          return const Center(child: CircularProgressIndicator());
        },
      ),
    );
  }
}
