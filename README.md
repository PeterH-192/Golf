# Golf (Flutter + Firebase) — Starter Repo

This is a minimal starter for a 2–6 player online **Golf** card game using **Flutter** (client) and **Firebase** (backend).
It includes:
- Flutter app scaffold in `app/`
- Firebase Functions scaffold in `functions/`
- Firestore/RTDB rules
- GitHub Pages workflow to deploy Flutter Web

## Quick start
1) Install Flutter & Firebase CLI:
```bash
flutter --version
npm i -g firebase-tools
firebase login
```

2) Create Firebase project and configure the app:
```bash
cd app
dart pub global activate flutterfire_cli
flutterfire configure
```

3) Install deps & run the app (web or device):
```bash
flutter pub get
flutter run -d chrome
```

4) Deploy Cloud Functions:
```bash
cd ../functions
npm install
npm run build
firebase deploy --only functions
```

5) Enable GitHub Pages: push this repo and check `.github/workflows/deploy-pages.yml`

## Notes
- Add your web domain (GitHub Pages) to **Firebase Auth → Authorized domains**.
- Replace placeholder Functions with your game engine as you iterate.
