# Chess Web Application

A fully functional online chess platform built with **React**, **Firebase**, and a custom **chess engine** written from scratch in JavaScript.

---

## Features

| Feature | Details |
|---|---|
| **Full chess engine** | All legal moves, check/checkmate/stalemate detection, castling, en passant, pawn promotion |
| **AI opponent** | Minimax + alpha-beta pruning; Easy / Medium / Hard difficulty |
| **Local 2-player** | Pass-and-play on the same screen |
| **Firebase Auth** | Google sign-in via Firebase Authentication |
| **10-minute clock** | Per-side countdown timer; timeout detection |
| **Move history** | Algebraic notation (e.g. Nf3, O-O, e8=Q#) |
| **Captured pieces** | Displayed per side |
| **Board flip** | View from Black's perspective |
| **Promotion modal** | Choose Q / R / B / N on pawn promotion |
| **Responsive** | Fluid square sizing across screen sizes |

---

## Quick Start (no build required)

Open **`chess-app.html`** directly in any modern browser — it loads React and Babel from CDN and runs immediately. No installation needed.

---

## React Project Setup

### 1. Create a new React app

```bash
npx create-react-app chess
cd chess
```

### 2. Replace `src/App.jsx` with the contents of `chess-app.jsx`

### 3. Install dependencies (none beyond React — everything is vanilla JS)

```bash
npm start
```

---

## Firebase Setup (optional — enables Google sign-in)

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Create a project → Add a Web App
3. Enable **Authentication → Google** sign-in provider
4. Copy your config object and paste it into `FIREBASE_CONFIG` at the top of `chess-app.jsx` / `chess-app.html`:

```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...",
};
```

The app works in **guest mode** without Firebase — just without sign-in.

---

## Project Files

```
chess-web-app/
├── chess-app.html    ← Standalone: open in browser, works immediately
├── chess-app.jsx     ← React component for use in a CRA / Vite project
└── README.md
```

---

## Chess Engine Architecture

```
initBoard()           → 8×8 array of piece strings ("wK", "bP", …)
rawMoves()            → Pseudo-legal moves (no check filtering)
legalMoves()          → Filters moves that leave own king in check
applyMove()           → Immutably applies a move, returns new state
isInCheck()           → King-safety test
gameStatus()          → "playing" | "checkmate" | "stalemate"
bestAIMove()          → Minimax + alpha-beta, depth 1–3
evaluate()            → Material + piece-square table heuristic
```

---

## Stack

- **React 18** — UI and state management
- **Firebase 10** — Authentication (Google sign-in)
- **Vanilla JS** — Chess engine (zero dependencies)
- **CSS variables** — Theming; dark luxury aesthetic with Playfair Display + Crimson Text
