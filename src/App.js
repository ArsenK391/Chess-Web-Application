import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// Firebase config 
// Paste your own config here to enable Google sign-in & online saving.
// Leave as-is to play in guest / local mode.
const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
const FIREBASE_ENABLED = Boolean(FIREBASE_CONFIG.apiKey);

// Chess engine
const PIECES = {
  wK:"♔", wQ:"♕", wR:"♖", wB:"♗", wN:"♘", wP:"♙",
  bK:"♚", bQ:"♛", bR:"♜", bB:"♝", bN:"♞", bP:"♟",
};

function initBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  const backRank = ["R","N","B","Q","K","B","N","R"];
  for (let c = 0; c < 8; c++) {
    b[0][c] = "b" + backRank[c];
    b[1][c] = "bP";
    b[6][c] = "wP";
    b[7][c] = "w" + backRank[c];
  }
  return b;
}

function color(piece) { return piece ? piece[0] : null; }
function type(piece)  { return piece ? piece[1] : null; }
function opp(c)       { return c === "w" ? "b" : "w"; }

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function rookMoves(board, r, c, col, moves) {
  for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    let nr = r+dr, nc = c+dc;
    while (inBounds(nr,nc)) {
      if (board[nr][nc]) { if (color(board[nr][nc]) !== col) moves.push([nr,nc]); break; }
      moves.push([nr,nc]); nr+=dr; nc+=dc;
    }
  }
}
function bishopMoves(board, r, c, col, moves) {
  for (const [dr,dc] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    let nr=r+dr, nc=c+dc;
    while (inBounds(nr,nc)) {
      if (board[nr][nc]) { if (color(board[nr][nc]) !== col) moves.push([nr,nc]); break; }
      moves.push([nr,nc]); nr+=dr; nc+=dc;
    }
  }
}

function rawMoves(board, r, c, enPassant, castling) {
  const piece = board[r][c];
  if (!piece) return [];
  const col = color(piece), t = type(piece);
  const moves = [];

  if (t === "P") {
    const dir = col === "w" ? -1 : 1;
    const start = col === "w" ? 6 : 1;
    if (inBounds(r+dir,c) && !board[r+dir][c]) {
      moves.push([r+dir,c]);
      if (r === start && !board[r+2*dir][c]) moves.push([r+2*dir,c]);
    }
    for (const dc of [-1,1]) {
      if (inBounds(r+dir,c+dc)) {
        if (board[r+dir][c+dc] && color(board[r+dir][c+dc]) !== col) moves.push([r+dir,c+dc]);
        if (enPassant && enPassant[0]===r+dir && enPassant[1]===c+dc) moves.push([r+dir,c+dc]);
      }
    }
  }
  else if (t === "N") {
    for (const [dr,dc] of [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]])
      if (inBounds(r+dr,c+dc) && color(board[r+dr][c+dc]) !== col) moves.push([r+dr,c+dc]);
  }
  else if (t === "B") bishopMoves(board,r,c,col,moves);
  else if (t === "R") rookMoves(board,r,c,col,moves);
  else if (t === "Q") { rookMoves(board,r,c,col,moves); bishopMoves(board,r,c,col,moves); }
  else if (t === "K") {
    for (const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]])
      if (inBounds(r+dr,c+dc) && color(board[r+dr][c+dc]) !== col) moves.push([r+dr,c+dc]);
    // Castling
    if (castling) {
      const row = col === "w" ? 7 : 0;
      if (r === row && c === 4) {
        if (castling[col+"K"] && !board[row][5] && !board[row][6])
          moves.push([row,6,"castle-k"]);
        if (castling[col+"Q"] && !board[row][3] && !board[row][2] && !board[row][1])
          moves.push([row,2,"castle-q"]);
      }
    }
  }
  return moves;
}

function isAttacked(board, r, c, byColor) {
  // Check if (r,c) is attacked by byColor
  for (let br = 0; br < 8; br++)
    for (let bc = 0; bc < 8; bc++)
      if (color(board[br][bc]) === byColor) {
        const ms = rawMoves(board, br, bc, null, null);
        if (ms.some(([mr,mc]) => mr===r && mc===c)) return true;
      }
  return false;
}

function findKing(board, col) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === col+"K") return [r,c];
  return null;
}

function isInCheck(board, col) {
  const king = findKing(board, col);
  return king ? isAttacked(board, king[0], king[1], opp(col)) : false;
}

function applyMove(board, from, to, enPassant, castling, promotion="Q") {
  const b = board.map(r => [...r]);
  const piece = b[from[0]][from[1]];
  const col = color(piece), t = type(piece);
  const newCastling = { ...castling };
  let newEnPassant = null;

  // En passant capture
  if (t === "P" && enPassant && to[0]===enPassant[0] && to[1]===enPassant[1]) {
    const captureRow = col === "w" ? to[0]+1 : to[0]-1;
    b[captureRow][to[1]] = null;
  }
  // Double pawn push → set en passant
  if (t === "P" && Math.abs(to[0]-from[0]) === 2)
    newEnPassant = [(from[0]+to[0])/2, to[1]];

  // Castling move
  if (t === "K") {
    newCastling[col+"K"] = false; newCastling[col+"Q"] = false;
    if (to[2] === "castle-k") {
      const row = col==="w" ? 7:0;
      b[row][5] = col+"R"; b[row][7] = null;
    } else if (to[2] === "castle-q") {
      const row = col==="w" ? 7:0;
      b[row][3] = col+"R"; b[row][0] = null;
    }
  }
  if (t === "R") {
    if (from[0]===7 && from[1]===7) newCastling["wK"]=false;
    if (from[0]===7 && from[1]===0) newCastling["wQ"]=false;
    if (from[0]===0 && from[1]===7) newCastling["bK"]=false;
    if (from[0]===0 && from[1]===0) newCastling["bQ"]=false;
  }

  b[to[0]][to[1]] = piece;
  b[from[0]][from[1]] = null;

  // Promotion
  if (t === "P" && (to[0]===0 || to[0]===7))
    b[to[0]][to[1]] = col + promotion;

  return { board: b, enPassant: newEnPassant, castling: newCastling };
}

function legalMoves(board, r, c, enPassant, castling) {
  const piece = board[r][c];
  if (!piece) return [];
  const col = color(piece);
  return rawMoves(board, r, c, enPassant, castling).filter(to => {
    const { board: nb } = applyMove(board, [r,c], to, enPassant, castling);
    return !isInCheck(nb, col);
  });
}

function allLegalMoves(board, col, enPassant, castling) {
  const moves = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (color(board[r][c]) === col)
        for (const to of legalMoves(board, r, c, enPassant, castling))
          moves.push({ from:[r,c], to });
  return moves;
}

function gameStatus(board, col, enPassant, castling) {
  const moves = allLegalMoves(board, col, enPassant, castling);
  if (moves.length > 0) return "playing";
  return isInCheck(board, col) ? "checkmate" : "stalemate";
}

// AI (minimax + alpha-beta) 
const PIECE_VALUES = { P:100, N:320, B:330, R:500, Q:900, K:20000 };
const PST = {
  P: [
    [0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],
    [5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],
    [5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]
  ],
  N: [
    [-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],
    [-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],
    [-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],
    [-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]
  ],
  B: [
    [-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],
    [-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],
    [-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],
    [-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]
  ],
};

function evaluate(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p) continue;
    const col = color(p), t = type(p);
    const sign = col === "w" ? 1 : -1;
    const pstRow = col === "w" ? r : 7-r;
    const val = PIECE_VALUES[t] + (PST[t]?.[pstRow]?.[c] ?? 0);
    score += sign * val;
  }
  return score;
}

function minimax(board, depth, alpha, beta, maximizing, enPassant, castling) {
  const col = maximizing ? "b" : "w";
  const status = gameStatus(board, col, enPassant, castling);
  if (depth === 0 || status !== "playing") {
    if (status === "checkmate") return maximizing ? -99999 : 99999;
    if (status === "stalemate") return 0;
    return evaluate(board);
  }
  const moves = allLegalMoves(board, col, enPassant, castling);
  if (maximizing) {
    let best = -Infinity;
    for (const { from, to } of moves) {
      const { board: nb, enPassant: ne, castling: nc } = applyMove(board, from, to, enPassant, castling);
      best = Math.max(best, minimax(nb, depth-1, alpha, beta, false, ne, nc));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const { from, to } of moves) {
      const { board: nb, enPassant: ne, castling: nc } = applyMove(board, from, to, enPassant, castling);
      best = Math.min(best, minimax(nb, depth-1, alpha, beta, true, ne, nc));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function bestAIMove(board, enPassant, castling, depth=3) {
  const moves = allLegalMoves(board, "b", enPassant, castling);
  if (!moves.length) return null;
  let best = -Infinity, bestMove = moves[0];
  for (const mv of moves) {
    const { board: nb, enPassant: ne, castling: nc } = applyMove(board, mv.from, mv.to, enPassant, castling);
    const score = minimax(nb, depth-1, -Infinity, Infinity, false, ne, nc);
    if (score > best) { best = score; bestMove = mv; }
  }
  return bestMove;
}

// Firebase hooks 
function useFirebaseAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(FIREBASE_ENABLED);
  const [firebase, setFirebase] = useState(null);

  useEffect(() => {
    if (!FIREBASE_ENABLED) { setLoading(false); return; }
    // Dynamically load Firebase SDKs
    const loadFirebase = async () => {
      try {
        const [
          { initializeApp },
          { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut },
        ] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"),
        ]);
        const app  = initializeApp(FIREBASE_CONFIG);
        const auth = getAuth(app);
        const fb = {
          signIn:  () => signInWithPopup(auth, new GoogleAuthProvider()),
          signOut: () => signOut(auth),
        };
        setFirebase(fb);
        onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
      } catch (e) {
        console.warn("Firebase failed to load:", e);
        setLoading(false);
      }
    };
    loadFirebase();
  }, []);

  return { user, loading, firebase };
}

// Styles
const css = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Crimson+Text:ital@0;1&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:        #0d0d0e;
  --surface:   #141416;
  --panel:     #1a1a1e;
  --border:    #2a2a30;
  --gold:      #c9a84c;
  --gold-dim:  #7a6230;
  --light-sq:  #e8d5b0;
  --dark-sq:   #7a5c3a;
  --light-sq-hl: #f0e070;
  --dark-sq-hl:  #b8a020;
  --text:      #e8e4d8;
  --muted:     #6a6660;
  --red:       #c0392b;
  --check-sq:  rgba(220,50,50,0.6);
  --move-dot:  rgba(0,0,0,0.22);
  --capture-ring: rgba(0,0,0,0.22);
}

body { background: var(--bg); color: var(--text); font-family: 'Crimson Text', Georgia, serif; }

/* ── Layout ── */
.app { min-height: 100vh; display:flex; flex-direction:column; }

.topbar {
  display:flex; align-items:center; justify-content:space-between;
  padding: 14px 32px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.logo {
  font-family: 'Playfair Display', serif;
  font-size: 1.5rem; font-weight:700;
  color: var(--gold);
  letter-spacing: 0.04em;
}
.logo span { font-style:italic; font-weight:400; }

.auth-area { display:flex; align-items:center; gap:12px; font-size:0.9rem; }
.btn-auth {
  padding: 7px 18px;
  background: transparent;
  border: 1px solid var(--gold-dim);
  color: var(--gold);
  font-family: 'Crimson Text', serif;
  font-size: 0.9rem;
  cursor:pointer; border-radius:2px;
  transition: all 0.2s;
}
.btn-auth:hover { background: rgba(201,168,76,0.1); border-color: var(--gold); }

/* ── Main ── */
.main {
  flex:1; display:flex; align-items:flex-start; justify-content:center;
  gap: 32px; padding: 32px;
  flex-wrap: wrap;
}

/* ── Board ── */
.board-area { display:flex; flex-direction:column; align-items:center; gap:10px; }

.player-tag {
  display:flex; align-items:center; gap:10px;
  font-family:'Playfair Display', serif;
  font-size:1rem; color: var(--text);
  width:100%;
}
.player-tag.bottom { justify-content:flex-end; }
.player-clock {
  margin-left:auto;
  font-family:'Playfair Display', serif;
  font-size:1rem;
  padding: 3px 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius:2px;
  min-width:64px; text-align:center;
  color: var(--gold);
}
.player-tag.bottom .player-clock { margin-left:0; margin-right:auto; }

.board-wrap {
  display:flex; gap:0;
}
.board-labels-col {
  display:flex; flex-direction:column; justify-content:space-around;
  width:18px;
  font-size:0.7rem; color: var(--muted);
  text-align:center; padding: 2px 0;
  user-select:none;
}
.board-labels-row {
  display:flex; justify-content:space-around;
  width: calc(8 * var(--sq)); height:18px;
  font-size:0.7rem; color: var(--muted);
  padding: 0 2px; user-select:none;
}

.board {
  --sq: clamp(52px, 8vw, 74px);
  display:grid;
  grid-template-columns: repeat(8, var(--sq));
  grid-template-rows:    repeat(8, var(--sq));
  border: 2px solid var(--gold-dim);
  box-shadow: 0 0 60px rgba(201,168,76,0.08), 0 8px 40px rgba(0,0,0,0.7);
}

.sq {
  --sq: clamp(52px, 8vw, 74px);
  width: var(--sq); height: var(--sq);
  display:flex; align-items:center; justify-content:center;
  position:relative; cursor:pointer;
  transition: background 0.08s;
  font-size: calc(var(--sq) * 0.72);
  line-height:1; user-select:none;
}
.sq.light { background: var(--light-sq); }
.sq.dark  { background: var(--dark-sq);  }
.sq.selected { background: var(--light-sq-hl) !important; }
.sq.selected.dark { background: var(--dark-sq-hl) !important; }
.sq.last-from, .sq.last-to { filter: brightness(1.15); }
.sq.in-check { background: var(--check-sq) !important; }

.sq:hover:not(.selected) { filter:brightness(1.08); }

/* Move dots */
.sq.can-move::after {
  content:''; position:absolute; border-radius:50%;
  width:30%; height:30%;
  background: var(--move-dot);
  pointer-events:none;
}
.sq.can-capture::after {
  content:''; position:absolute; border-radius:50%;
  width:90%; height:90%;
  border: 8% solid var(--capture-ring);
  background: transparent;
  pointer-events:none;
}

.piece { position:relative; z-index:1; line-height:1; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.5)); }

/* ── Side Panel ── */
.side-panel {
  width:260px; display:flex; flex-direction:column; gap:16px;
  padding-top: 38px;
}

.panel-section {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius:3px;
  padding:16px;
}
.panel-title {
  font-family:'Playfair Display', serif;
  font-size:0.75rem; letter-spacing:0.15em;
  text-transform:uppercase; color: var(--gold-dim);
  margin-bottom:12px;
}

/* Mode buttons */
.mode-btns { display:flex; flex-direction:column; gap:6px; }
.btn-mode {
  padding: 9px 14px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  font-family:'Crimson Text', serif;
  font-size:1rem;
  cursor:pointer; border-radius:2px; text-align:left;
  transition: all 0.2s;
  display:flex; align-items:center; gap:10px;
}
.btn-mode:hover { border-color: var(--gold-dim); background: rgba(201,168,76,0.05); }
.btn-mode.active { border-color: var(--gold); color: var(--gold); background: rgba(201,168,76,0.08); }
.btn-mode .icon { font-size:1.2rem; }

/* Difficulty */
.diff-row { display:flex; gap:6px; }
.btn-diff {
  flex:1; padding:6px 4px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  font-family:'Crimson Text', serif;
  font-size:0.85rem;
  cursor:pointer; border-radius:2px;
  transition: all 0.15s;
}
.btn-diff.active { border-color:var(--gold); color:var(--gold); }
.btn-diff:hover  { border-color:var(--gold-dim); color:var(--text); }

/* Action buttons */
.action-btns { display:flex; gap:8px; }
.btn-action {
  flex:1; padding:9px 8px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  font-family:'Crimson Text', serif;
  font-size:0.95rem;
  cursor:pointer; border-radius:2px;
  transition: all 0.2s;
}
.btn-action:hover { border-color: var(--gold-dim); }
.btn-action.danger:hover { border-color:var(--red); color:var(--red); }

/* Move history */
.history-list {
  max-height:200px; overflow-y:auto;
  font-size:0.9rem;
  display:grid; grid-template-columns:1fr 1fr; gap:2px 8px;
}
.history-list::-webkit-scrollbar { width:4px; }
.history-list::-webkit-scrollbar-track { background:transparent; }
.history-list::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
.hist-num { color:var(--muted); font-size:0.78rem; }
.hist-move { cursor:default; }
.hist-move:hover { color:var(--gold); }

/* Status banner */
.status-banner {
  padding:12px 14px;
  border:1px solid var(--gold-dim);
  background: rgba(201,168,76,0.06);
  border-radius:2px;
  font-family:'Playfair Display', serif;
  font-size:0.95rem;
  color: var(--gold);
  text-align:center;
  line-height:1.5;
}
.status-banner.check { border-color:var(--red); background:rgba(192,57,43,0.1); color:#e05555; }
.status-banner.end   { border-color:var(--gold); background:rgba(201,168,76,0.12); }

/* Captured pieces */
.captured { display:flex; flex-wrap:wrap; gap:1px; font-size:1.2rem; min-height:26px; }

/* Promotion modal */
.promo-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,0.75);
  display:flex; align-items:center; justify-content:center; z-index:100;
}
.promo-box {
  background:var(--panel); border:1px solid var(--gold);
  border-radius:4px; padding:24px;
  display:flex; flex-direction:column; align-items:center; gap:16px;
}
.promo-box h3 { font-family:'Playfair Display',serif; color:var(--gold); }
.promo-pieces { display:flex; gap:8px; }
.btn-promo {
  width:64px; height:64px; font-size:2.8rem;
  background:var(--surface); border:1px solid var(--border);
  cursor:pointer; border-radius:3px;
  transition: border-color 0.15s;
}
.btn-promo:hover { border-color:var(--gold); }

/* Thinking */
.thinking-bar {
  display:flex; align-items:center; gap:8px;
  font-size:0.8rem; color:var(--muted); font-style:italic;
}
.thinking-dots span {
  display:inline-block; width:5px; height:5px; border-radius:50%;
  background:var(--gold-dim); margin:0 1px;
  animation: tdot 1.2s infinite;
}
.thinking-dots span:nth-child(2) { animation-delay:.2s; }
.thinking-dots span:nth-child(3) { animation-delay:.4s; }
@keyframes tdot { 0%,80%,100%{opacity:.2} 40%{opacity:1} }

/* Turn indicator dot */
.turn-dot {
  width:8px; height:8px; border-radius:50%;
  border:1px solid var(--muted);
}
.turn-dot.active { border-color:var(--gold); background:var(--gold); }
`;

// Notation helpers 
const FILES = ["a","b","c","d","e","f","g","h"];
function toAN(r, c) { return FILES[c] + (8-r); }
function moveNotation(board, from, to, promotion) {
  const piece = board[from[0]][from[1]];
  if (!piece) return "";
  const t = type(piece);
  const capture = board[to[0]][to[1]] ? "x" : "";
  const dest = toAN(to[0], to[1]);
  if (t === "P") {
    const base = capture ? FILES[from[1]] + "x" + dest : dest;
    return base + (promotion ? "="+promotion : "");
  }
  if (to[2] === "castle-k") return "O-O";
  if (to[2] === "castle-q") return "O-O-O";
  return t + capture + dest;
}

// Main App 
export default function ChessApp() {
  const { user, loading, firebase } = useFirebaseAuth();

  // Game state
  const initCastling = { wK:true, wQ:true, bK:true, bQ:true };
  const [board,      setBoard]      = useState(initBoard);
  const [turn,       setTurn]       = useState("w");
  const [selected,   setSelected]   = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [enPassant,  setEnPassant]  = useState(null);
  const [castling,   setCastling]   = useState(initCastling);
  const [lastMove,   setLastMove]   = useState(null);
  const [history,    setHistory]    = useState([]);   // [{notation, board, turn}]
  const [status,     setStatus]     = useState("playing"); // playing|checkmate|stalemate|draw
  const [capturedW,  setCapturedW]  = useState([]);  // captured by white
  const [capturedB,  setCapturedB]  = useState([]);
  const [mode,       setMode]       = useState("ai"); // ai|local|online
  const [difficulty, setDifficulty] = useState(2);
  const [aiThinking, setAiThinking] = useState(false);
  const [promoState, setPromoState] = useState(null); // {from,to} pending
  const [flipped,    setFlipped]    = useState(false);
  const [whiteTime,  setWhiteTime]  = useState(600);
  const [blackTime,  setBlackTime]  = useState(600);
  const timerRef = useRef(null);

  // Timer
  useEffect(() => {
    if (status !== "playing") { clearInterval(timerRef.current); return; }
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (turn === "w") setWhiteTime(t => { if(t<=1){clearInterval(timerRef.current);setStatus("timeout-b");return 0;} return t-1; });
      else              setBlackTime(t => { if(t<=1){clearInterval(timerRef.current);setStatus("timeout-w");return 0;} return t-1; });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [turn, status]);

  function fmtTime(s) {
    const m = Math.floor(s/60), sec = s%60;
    return `${m}:${sec.toString().padStart(2,"0")}`;
  }

  // AI trigger
  useEffect(() => {
    if (mode !== "ai" || turn !== "b" || status !== "playing") return;
    setAiThinking(true);
    const depth = difficulty;
    const t = setTimeout(() => {
      const mv = bestAIMove(board, enPassant, castling, depth);
      if (mv) {
        executeMove(mv.from, mv.to, "Q");
      }
      setAiThinking(false);
    }, 300);
    return () => clearTimeout(t);
  }, [turn, mode, status]);

  function executeMove(from, to, promo) {
    const { board: nb, enPassant: ne, castling: nc } = applyMove(board, from, to, enPassant, castling, promo);
    const notation = moveNotation(board, from, to, promo);
    const captured = board[to[0]][to[1]];
    if (captured) {
      if (color(captured) === "b") setCapturedW(p => [...p, captured]);
      else setCapturedB(p => [...p, captured]);
    }
    const nextTurn = opp(turn);
    const st = gameStatus(nb, nextTurn, ne, nc);
    const inCheck = isInCheck(nb, nextTurn);
    const fullNotation = notation + (st==="checkmate" ? "#" : inCheck ? "+" : "");
    setBoard(nb);
    setEnPassant(ne);
    setCastling(nc);
    setTurn(nextTurn);
    setLastMove([from, to]);
    setSelected(null);
    setHighlights([]);
    setHistory(h => [...h, { notation: fullNotation, turn }]);
    if (st !== "playing") setStatus(st);
  }

  function handleSquareClick(r, c) {
    if (status !== "playing") return;
    if (mode === "ai" && turn === "b") return;
    if (aiThinking) return;

    const piece = board[r][c];

    if (selected) {
      // Try to move
      const move = highlights.find(([hr,hc]) => hr===r && hc===c);
      if (move) {
        // Check promotion
        const t = type(board[selected[0]][selected[1]]);
        const isPromo = t==="P" && (r===0 || r===7);
        if (isPromo) { setPromoState({ from:selected, to:[r,c,...move.slice(2)] }); return; }
        executeMove(selected, [r,c,...move.slice(2)], "Q");
        return;
      }
      // Reselect
      if (piece && color(piece) === turn) {
        setSelected([r,c]);
        setHighlights(legalMoves(board, r, c, enPassant, castling));
        return;
      }
      setSelected(null); setHighlights([]);
      return;
    }

    if (piece && color(piece) === turn) {
      setSelected([r,c]);
      setHighlights(legalMoves(board, r, c, enPassant, castling));
    }
  }

  function handlePromotion(promo) {
    if (!promoState) return;
    executeMove(promoState.from, promoState.to, promo);
    setPromoState(null);
  }

  function newGame() {
    clearInterval(timerRef.current);
    setBoard(initBoard());
    setTurn("w"); setSelected(null); setHighlights([]);
    setEnPassant(null); setCastling(initCastling);
    setLastMove(null); setHistory([]); setStatus("playing");
    setCapturedW([]); setCapturedB([]);
    setWhiteTime(600); setBlackTime(600);
    setAiThinking(false);
  }

  function resign() {
    setStatus(turn === "w" ? "resign-w" : "resign-b");
    clearInterval(timerRef.current);
  }

  // Render helpers
  const inCheckKing = useMemo(() => {
    if (status === "playing" && isInCheck(board, turn)) return findKing(board, turn);
    return null;
  }, [board, turn, status]);

  function renderBoard() {
    const rows = flipped ? [0,1,2,3,4,5,6,7] : [0,1,2,3,4,5,6,7];
    const cols = flipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    return rows.map(r =>
      cols.map(c => {
        const piece = board[r][c];
        const isLight = (r+c)%2===0;
        const isSel = selected && selected[0]===r && selected[1]===c;
        const canMove = highlights.some(([hr,hc]) => hr===r && hc===c);
        const isCapture = canMove && board[r][c] !== null;
        const isLastFrom = lastMove && lastMove[0][0]===r && lastMove[0][1]===c;
        const isLastTo   = lastMove && lastMove[1][0]===r && lastMove[1][1]===c;
        const isCheck = inCheckKing && inCheckKing[0]===r && inCheckKing[1]===c;

        let cls = `sq ${isLight?"light":"dark"}`;
        if (isSel)       cls += " selected";
        if (isLastFrom)  cls += " last-from";
        if (isLastTo)    cls += " last-to";
        if (isCheck)     cls += " in-check";
        if (canMove && !isCapture) cls += " can-move";
        if (isCapture)   cls += " can-capture";

        return (
          <div key={`${r}-${c}`} className={cls} onClick={() => handleSquareClick(r,c)}>
            {piece && <span className="piece">{PIECES[piece]}</span>}
          </div>
        );
      })
    );
  }

  const statusText = useMemo(() => {
    if (status === "playing") {
      if (isInCheck(board, turn)) return { text: `${turn==="w"?"White":"Black"} is in check!`, cls:"check" };
      if (aiThinking) return null;
      return { text: `${turn==="w"?"White":"Black"} to move`, cls:"" };
    }
    if (status === "checkmate") return { text: `Checkmate — ${opp(turn)==="w"?"White":"Black"} wins!`, cls:"end" };
    if (status === "stalemate") return { text: "Stalemate — Draw!", cls:"end" };
    if (status === "resign-w")  return { text: "White resigned — Black wins!", cls:"end" };
    if (status === "resign-b")  return { text: "Black resigned — White wins!", cls:"end" };
    if (status === "timeout-w") return { text: "White timed out — Black wins!", cls:"end" };
    if (status === "timeout-b") return { text: "Black timed out — White wins!", cls:"end" };
    return null;
  }, [status, turn, aiThinking, board]);

  // Group history into pairs
  const historyPairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < history.length; i += 2)
      pairs.push({ n: Math.floor(i/2)+1, w: history[i]?.notation, b: history[i+1]?.notation });
    return pairs;
  }, [history]);

  const promoCol = promoState ? color(board[promoState.from[0]][promoState.from[1]]) : null;

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* Top bar */}
        <div className="topbar">
          <div className="logo">Chess<span>Board</span></div>
          <div className="auth-area">
            {FIREBASE_ENABLED ? (
              loading ? <span style={{color:"var(--muted)"}}>Loading…</span> :
              user ? (
                <>
                  <span style={{color:"var(--muted)"}}>
                    {user.displayName || user.email}
                  </span>
                  <button className="btn-auth" onClick={() => firebase?.signOut()}>Sign out</button>
                </>
              ) : (
                <button className="btn-auth" onClick={() => firebase?.signIn()}>
                  Sign in with Google
                </button>
              )
            ) : (
              <span style={{color:"var(--muted)",fontSize:"0.8rem",fontStyle:"italic"}}>
                Guest mode — add Firebase config to enable accounts
              </span>
            )}
          </div>
        </div>

        {/* Main */}
        <div className="main">
          {/* Board column */}
          <div className="board-area">
            {/* Black player */}
            <div className="player-tag">
              <div className="turn-dot" style={{background: turn==="b"&&status==="playing"?"var(--gold)":"transparent", borderColor: turn==="b"&&status==="playing"?"var(--gold)":"var(--muted)"}} />
              <span>{mode==="ai" ? "Computer" : "Black"}</span>
              <div className="player-clock" style={{color: blackTime < 30 ? "var(--red)" : "var(--gold)"}}>
                {fmtTime(blackTime)}
              </div>
            </div>

            {/* Board + coordinates */}
            <div style={{display:"flex",flexDirection:"column",gap:0}}>
              <div className="board-wrap">
                <div className="board-labels-col">
                  {(flipped?[1,2,3,4,5,6,7,8]:[8,7,6,5,4,3,2,1]).map(n=><span key={n}>{n}</span>)}
                </div>
                <div className="board">{renderBoard()}</div>
              </div>
              <div style={{display:"flex"}}>
                <div style={{width:18}}/>
                <div className="board-labels-row">
                  {(flipped?["h","g","f","e","d","c","b","a"]:["a","b","c","d","e","f","g","h"]).map(f=><span key={f}>{f}</span>)}
                </div>
              </div>
            </div>

            {/* White player */}
            <div className="player-tag bottom">
              <div className="player-clock" style={{color: whiteTime < 30 ? "var(--red)" : "var(--gold)"}}>
                {fmtTime(whiteTime)}
              </div>
              <span>{user ? user.displayName?.split(" ")[0] || "You" : "White"}</span>
              <div className="turn-dot" style={{background: turn==="w"&&status==="playing"?"var(--gold)":"transparent", borderColor: turn==="w"&&status==="playing"?"var(--gold)":"var(--muted)"}} />
            </div>
          </div>

          {/* Side panel */}
          <div className="side-panel">
            {/* Status */}
            {statusText && (
              <div className={`status-banner ${statusText.cls}`}>{statusText.text}</div>
            )}
            {aiThinking && (
              <div className="thinking-bar">
                <span>Computer thinking</span>
                <span className="thinking-dots"><span/><span/><span/></span>
              </div>
            )}

            {/* Mode */}
            <div className="panel-section">
              <div className="panel-title">Game Mode</div>
              <div className="mode-btns">
                <button className={`btn-mode ${mode==="ai"?"active":""}`}
                  onClick={()=>{setMode("ai");newGame();}}>
                  <span className="icon">🤖</span> vs Computer
                </button>
                <button className={`btn-mode ${mode==="local"?"active":""}`}
                  onClick={()=>{setMode("local");newGame();}}>
                  <span className="icon">👥</span> Local 2 Players
                </button>
              </div>
              {mode==="ai" && (
                <div style={{marginTop:10}}>
                  <div className="panel-title">Difficulty</div>
                  <div className="diff-row">
                    {[{l:"Easy",v:1},{l:"Medium",v:2},{l:"Hard",v:3}].map(({l,v})=>(
                      <button key={v} className={`btn-diff ${difficulty===v?"active":""}`}
                        onClick={()=>setDifficulty(v)}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="panel-section">
              <div className="panel-title">Actions</div>
              <div className="action-btns">
                <button className="btn-action" onClick={newGame}>New Game</button>
                <button className="btn-action" onClick={()=>setFlipped(f=>!f)}>Flip</button>
                <button className="btn-action danger" onClick={resign}>Resign</button>
              </div>
            </div>

            {/* Captured */}
            <div className="panel-section">
              <div className="panel-title">Captured by White</div>
              <div className="captured">{capturedW.map((p,i)=><span key={i}>{PIECES[p]}</span>)}</div>
              <div className="panel-title" style={{marginTop:10}}>Captured by Black</div>
              <div className="captured">{capturedB.map((p,i)=><span key={i}>{PIECES[p]}</span>)}</div>
            </div>

            {/* Move history */}
            <div className="panel-section">
              <div className="panel-title">Move History</div>
              <div className="history-list">
                {historyPairs.map(({n,w,b})=>(
                  <>
                    <span key={`n${n}`} className="hist-num">{n}.</span>
                    <span key={`w${n}`} className="hist-move">{w} {b||""}</span>
                  </>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Promotion modal */}
      {promoState && (
        <div className="promo-overlay">
          <div className="promo-box">
            <h3>Promote Pawn</h3>
            <div className="promo-pieces">
              {["Q","R","B","N"].map(p=>(
                <button key={p} className="btn-promo" onClick={()=>handlePromotion(p)}>
                  {PIECES[promoCol+p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
