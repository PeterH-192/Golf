enum Suit { clubs, diamonds, hearts, spades, joker }

enum Rank { ace, two, three, four, five, six, seven, eight, nine, ten, jack, queen, king, joker }

class Card {
  final Suit suit;
  final Rank rank;
  bool isFaceUp = false;

  Card(this.suit, this.rank);

  factory Card.fromJson(Map<String, dynamic> json) {
    return Card(
      Suit.values[json['suit']],
      Rank.values[json['rank']],
    )..isFaceUp = json['isFaceUp'] ?? false;
  }

  Map<String, dynamic> toJson() => {
    'suit': suit.index,
    'rank': rank.index,
    'isFaceUp': isFaceUp,
  };

  @override
  String toString() {
    return '${rank.name}_of_${suit.name}';
  }
}

class Player {
  final String uid;
  final int seat;
  final bool ready;
  final bool online;
  final List<Card> hand;
  final Card? drawnCard;

  Player({
    required this.uid,
    required this.seat,
    required this.ready,
    required this.online,
    required this.hand,
    this.drawnCard,
  });

  factory Player.fromJson(Map<String, dynamic> json) {
    return Player(
      uid: json['uid'],
      seat: json['seat'],
      ready: json['ready'],
      online: json['online'],
      hand: (json['hand'] as List<dynamic>? ?? [])
          .map((c) => Card.fromJson(c as Map<String, dynamic>))
          .toList(),
      drawnCard: json['drawnCard'] != null ? Card.fromJson(json['drawnCard']) : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'uid': uid,
        'seat': seat,
        'ready': ready,
        'online': online,
        'hand': hand.map((c) => c.toJson()).toList(),
        'drawnCard': drawnCard?.toJson(),
      };

  Player copyWith({
    String? uid,
    int? seat,
    bool? ready,
    bool? online,
    List<Card>? hand,
    Card? drawnCard,
  }) {
    return Player(
      uid: uid ?? this.uid,
      seat: seat ?? this.seat,
      ready: ready ?? this.ready,
      online: online ?? this.online,
      hand: hand ?? this.hand,
      drawnCard: drawnCard,
    );
  }
}

class Game {
  final String id;
  final String status;
  final String ownerUid;
  final List<Player> players;
  final List<Card> deck;
  final List<Card> discardPile;
  final String? currentTurn;
  final int? turnEndsAt;
  final String? knockerUid;
  final Map<String, int> scores;

  Game({
    required this.id,
    required this.status,
    required this.ownerUid,
    required this.players,
    required this.deck,
    required this.discardPile,
    this.currentTurn,
    this.turnEndsAt,
    this.knockerUid,
    this.scores = const {},
  });

  factory Game.fromFirestore(String id, Map<String, dynamic> data) {
    return Game(
      id: id,
      status: data['status'] ?? 'waiting',
      ownerUid: data['ownerUid'] ?? '',
      players: (data['players'] as List<dynamic>? ?? [])
          .map((p) => Player.fromJson(p as Map<String, dynamic>))
          .toList(),
      deck: (data['deck'] as List<dynamic>? ?? [])
          .map((c) => Card.fromJson(c as Map<String, dynamic>))
          .toList(),
      discardPile: (data['discardPile'] as List<dynamic>? ?? [])
          .map((c) => Card.fromJson(c as Map<String, dynamic>))
          .toList(),
      currentTurn: data['currentTurn'],
      turnEndsAt: data['turnEndsAt'],
      knockerUid: data['knockerUid'],
      scores: Map<String, int>.from(data['scores'] ?? {}),
    );
  }
}
