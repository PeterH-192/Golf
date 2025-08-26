import 'package:flutter/material.dart';
import 'models.dart';

class CardWidget extends StatelessWidget {
  final Card card;
  final VoidCallback? onTap;

  const CardWidget({super.key, required this.card, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 80,
        height: 120,
        decoration: BoxDecoration(
          color: card.isFaceUp ? Colors.white : Colors.blue,
          border: Border.all(color: Colors.black),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Center(
          child: card.isFaceUp ? Text(_cardText, style: const TextStyle(fontSize: 20)) : null,
        ),
      ),
    );
  }

  String get _cardText {
    if (card.rank == Rank.joker) return 'Joker';
    final rankStr = 'A23456789TJQK'[card.rank.index];
    final suitStr = '♣♦♥♠'[card.suit.index];
    return '$rankStr$suitStr';
  }
}
