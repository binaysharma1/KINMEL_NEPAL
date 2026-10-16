import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, X, Send, Sparkles, RotateCcw, Move, LogIn, UserRound } from 'lucide-react';

/* ==========================================================================
 * KinMel Assistant — floating, corner-snapping chat launcher
 *
 * Behaviour
 *  - Tap the launcher  -> panel opens / closes.
 *  - Drag the launcher -> snaps to whichever of the 4 corners you released
 *                        it in (with a velocity "fling" hint, so a fast
 *                        flick wins over the raw pointer position).
 *  - Panel placement   -> always on the side of the viewport that keeps the
 *                        most of the page visible:
 *                          * desktop: horizontally opposite the launcher,
 *                            vertically aligned with it and clamped so it
 *                            can never leave the viewport.
 *                          * mobile : a bottom sheet sized to dodge the
 *                            launcher, so both are always visible.
 *
 * Everything is self contained: no state lives outside this file, no global
 * listeners leak, and every timer is cleaned up on unmount.
 * ========================================================================== */

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */
const PANEL_ID = 'kinmel-chat-panel';
const CORNER_KEY = 'kinmel:chatbot-corner';
const HINT_KEY = 'kinmel:chatbot-hint-seen';

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const isLeftCorner = (c) => c === 'top-left' || c === 'bottom-left';
const isTopCorner = (c) => c === 'top-left' || c === 'top-right';

/** Distance kept between the docked launcher and the viewport edges. */
const EDGE_X = 20;
const EDGE_Y = 20;
const EDGE_BOTTOM = 24;

/** Distance kept between the chat panel and the viewport edges. */
const PANEL_GAP = 16;
/** Distance kept between the panel and the launcher when it opens beside it. */
const BESIDE_GAP = 12;
const PANEL_W = 400;
const PANEL_H = 620;
const MOBILE_BREAKPOINT = 640;

/** A pointer that travels less than TAP_SLOP px in TAP_TIME ms is a tap. */
const TAP_SLOP = 8;
const TAP_TIME = 600;

/** px/ms that counts as a deliberate fling to a side. */
const FLING = 0.45;

/* ------------------------------------------------------------------ *
 * Auth — matches how the rest of the app stores the session
 * (Login.jsx writes these keys, Navbar.jsx clears them on logout).
 * ------------------------------------------------------------------ */
const AUTH_TOKEN_KEY = 'userToken';
const AUTH_EMAIL_KEY = 'userEmail';
const AUTH_NAME_KEY = 'userName';

/**
 * The Express gateway. It owns authentication: it verifies the JWT and only
 * forwards the turn to FastAPI when the token is good.
 *   -> 200 { success, reply }              the assistant answered
 *   -> 401                                 not signed in / session lapsed
 *   -> 502 / 503 / 504                     the assistant service is unhealthy
 */
const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').replace(/\/+$/, '');
const CHAT_URL = `${API_BASE}/api/chat`;
const CHAT_TIMEOUT = 35000; // FastAPI model calls can be slow

/** Springy easing used for the corner snap. */
const SNAP_EASE = 'transform 520ms cubic-bezier(.34, 1.4, .5, 1)';
const PANEL_EASE = 'cubic-bezier(.22, 1, .36, 1)';

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/* ------------------------------------------------------------------ *
 * Small browser helpers
 * ------------------------------------------------------------------ */
function readCorner() {
  try {
    const stored = window.localStorage.getItem(CORNER_KEY);
    return CORNERS.includes(stored) ? stored : 'bottom-left';
  } catch {
    return 'bottom-left';
  }
}

function saveCorner(corner) {
  try {
    window.localStorage.setItem(CORNER_KEY, corner);
  } catch {
    /* private mode / storage disabled — non fatal */
  }
}

function readHintSeen() {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
}

function markHintSeen() {
  try {
    window.localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* ignore */
  }
}

/* ------------------------- auth helpers ------------------------- */

/** Decodes a JWT payload. Returns null when it is not a readable token. */
function decodeJwt(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Reads the session from storage.
 *   status: 'guest'  -> no token at all
 *           'expired' -> token present but past its `exp`
 *           'authed'  -> usable JWT
 */
function readSession() {
  const guest = { status: 'guest', token: null, name: '', email: '', id: null };
  let token = null;
  try {
    token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return guest;
  }
  if (!token) return guest;

  const claims = decodeJwt(token) || {};
  const expired = typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now();
  const email = claims.email || safeStorage(AUTH_EMAIL_KEY) || '';
  const name = safeStorage(AUTH_NAME_KEY) || claims.name || email.split('@')[0] || '';

  return {
    status: expired ? 'expired' : 'authed',
    token,
    name,
    email,
    id: claims.id || claims._id || claims.userId || null,
  };
}

function safeStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Drops a stale session so `/login` does not bounce straight back out. */
function clearSession() {
  try {
    [AUTH_TOKEN_KEY, AUTH_EMAIL_KEY, AUTH_NAME_KEY].forEach((k) =>
      window.localStorage.removeItem(k),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Sends one turn to the Express gateway, carrying the JWT the same way the
 * rest of this app does (the `token` header that `verifyToken` reads).
 *
 * Returns a discriminated result instead of throwing, because each failure
 * means something different to the user:
 *   { kind: 'reply',   text }  the assistant answered
 *   { kind: 'auth' }            Express rejected the JWT -> suggest login
 *   { kind: 'down',   text }   gateway/assistant unreachable -> offline help
 */
async function askExpress(text, session, history, signal) {
  const controller = new AbortController();
  const killer = setTimeout(() => controller.abort(), CHAT_TIMEOUT);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  /* Always read the token from storage at send time. React state can be a
     tick behind a logout (the launcher is not remounted by a route change), and
     sending a token the user has just discarded would let a logged-out visitor
     keep chatting. Storage is the only source of truth. */
  const token = safeStorage(AUTH_TOKEN_KEY) || session?.token;

  try {
    const response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { token } : {}),
      },
      body: JSON.stringify({ message: text, history }),
      signal: controller.signal,
    });

    if (response.status === 401) return { kind: 'auth' };

    let data = null;
    try {
      data = await response.json();
    } catch {
      /* non-JSON error body */
    }

    if (!response.ok || !data?.success) {
      return {
        kind: 'down',
        text:
          data?.message ||
          "The assistant is having trouble right now. Please try again in a moment.",
      };
    }

    const reply = data.reply ?? data.message;
    if (typeof reply !== 'string' || !reply.trim()) {
      return { kind: 'down', text: "The assistant gave an empty response. Please try again." };
    }
    return { kind: 'reply', text: reply };
  } catch {
    /* Express itself is down, or the request timed out. */
    return {
      kind: 'down',
      text: "I can't reach our assistant service right now. Please try again shortly.",
    };
  } finally {
    clearTimeout(killer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Measures the iOS home-indicator inset once and reuses the probe node.
 * Returns 0 on platforms without a safe area.
 */
let safeAreaProbe = null;
function readSafeAreaBottom() {
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.setAttribute('aria-hidden', 'true');
    safeAreaProbe.style.cssText =
      'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(safeAreaProbe);
  }
  return parseFloat(window.getComputedStyle(safeAreaProbe).paddingBottom) || 0;
}

/** Pixel offset of the launcher for a given corner. */
function dockPosition(corner, viewport, size) {
  return {
    x: isLeftCorner(corner) ? EDGE_X : viewport.w - EDGE_X - size.w,
    y: isTopCorner(corner)
      ? EDGE_Y
      : viewport.h - (EDGE_BOTTOM + viewport.safeBottom) - size.h,
  };
}

/**
 * Picks the corner to snap to. A deliberate flick beats the pointer position,
 * which is what makes fast, imprecise drags still land where you expect.
 */
function resolveCorner(px, py, vx, vy, viewport) {
  const goLeft = Math.abs(vx) > FLING ? vx < 0 : px < viewport.w / 2;
  const goTop = Math.abs(vy) > FLING ? vy < 0 : py < viewport.h / 2;
  return `${goTop ? 'top' : 'bottom'}-${goLeft ? 'left' : 'right'}`;
}

/* ------------------------------------------------------------------ *
 * Assistant brain (local, deterministic-by-intent — no backend needed)
 * ------------------------------------------------------------------ */
const includes = (text, ...words) => words.some((word) => text.includes(word));

const INTENTS = [
  {
    id: 'greeting',
    test: (t) =>
      /^(hi|hey|hello|yo|namaste|hii+|hola)\b/.test(t) && t.split(/\s+/).length <= 3,
    replies: [
      "Hey! I'm KinMel Assistant. I can track orders, walk you through returns, or help you find the right product. What do you need?",
      'Hi there! Tell me what you are shopping for, or share an order ID and I will check it for you.',
    ],
    chips: ['Track my order', 'Return policy', 'Talk to a human'],
  },
  {
    id: 'thanks',
    test: (t) => includes(t, 'thanks', 'thank you', 'thx', 'shukriya', 'appreciate'),
    replies: [
      'Happy to help! Anything else I can sort out for you?',
      'Anytime! I am here if you need anything else.',
    ],
    chips: ['Best deals', 'Track my order', 'Talk to a human'],
  },
  {
    id: 'bye',
    test: (t) => includes(t, 'bye', 'goodbye', 'see you', 'later'),
    replies: ['Take care! I will be right here whenever you need me.', 'See you soon! Happy shopping.'],
    chips: ['New arrivals', 'Best sellers'],
  },
  {
    id: 'cancel',
    test: (t) => includes(t, 'cancel', 'stop my order', 'do not want it anymore'),
    replies: [
      'I can cancel that for you. Orders placed in the last 30 minutes can be cancelled instantly — just share your order ID.',
      'No problem. Share the order ID and I will raise the cancellation request right away.',
    ],
    chips: ['Where is my order?', 'Change my address', 'Talk to a human'],
  },
  {
    id: 'returns',
    test: (t) => includes(t, 'return', 'refund', 'exchange', 'money back', 'reverse'),
    replies: [
      'We accept returns within 15 days of delivery for unworn items with tags intact. Refunds are issued to the original payment method within 3–5 business days.',
      'Easy — returns are free within 15 days of delivery. Want me to start a return or swap it for a different size?',
    ],
    chips: ['Start a return', 'Exchange for a bigger size', 'Refund status'],
  },
  {
    id: 'shipping',
    test: (t) => includes(t, 'shipping', 'delivery', 'how long', 'when will', 'arrive', 'courier', 'dispatch'),
    replies: [
      'Standard delivery takes 3–6 business days. Express shipping arrives in 1–2 days and is free on orders above ₹1,999.',
      'We dispatch within 24 hours on weekdays. You will get a tracking link by email and SMS the moment your parcel leaves the warehouse.',
    ],
    chips: ['Track my order', 'Do you ship internationally?', 'Talk to a human'],
  },
  {
    id: 'discount',
    test: (t) => includes(t, 'coupon', 'discount', 'offer', 'promo', 'code', 'sale', 'deal', 'cheap'),
    replies: [
      'Try KINMEL10 for 10% off your first order, or NEW20 for 20% off orders above ₹2,499. One coupon per order.',
      'Right now everything under the sale collection is up to 40% off, and stacking KINMEL10 on top gives you an extra 10%.',
    ],
    chips: ['Best deals', 'New arrivals', 'How do I apply a coupon?'],
  },
  {
    id: 'payment',
    test: (t) => includes(t, 'payment', 'pay', 'upi', 'card', 'netbanking', 'razorpay', 'stripe', 'emi', 'cod'),
    replies: [
      'We accept UPI, cards, net banking and EMI, all over 256-bit encrypted checkout. Cash on delivery is available under ₹1,500.',
      'Payments are fully secured — no card details are ever stored on our servers. Which method would you like to use?',
    ],
    chips: ['Cash on delivery?', 'Payment failed', 'Talk to a human'],
  },
  {
    id: 'human',
    test: (t) => includes(t, 'human', 'agent', 'call', 'phone', 'whatsapp', 'email', 'complaint', 'manager', 'support'),
    replies: [
      'Our support team is available Mon–Sat, 10am–7pm. Share your number and an agent will call you back within 15 minutes.',
      'I can hand you over to a human agent. What is the best number or email to reach you on?',
    ],
    chips: ['Email support', 'Track my order', 'Return policy'],
  },
  {
    id: 'track',
    test: (t) => includes(t, 'track', 'where is my order', 'order status', 'order id', 'shipped yet', 'has it shipped'),
    replies: [
      'Happy to check that. Please share your order ID — it looks like KM-00000 — and I will pull up the live status.',
      'Send me the order ID and the courier name if you have it, and I will trace the parcel for you.',
    ],
    chips: ['How long does shipping take?', 'Cancel my order', 'Change my address'],
  },
  {
    id: 'product',
    test: (t) =>
      includes(t, 'product', 'size', 'fit', 'fabric', 'cotton', 'quality', 'available', 'stock', 'colour', 'color', 'material', 'jeans', 'shirt', 'dress'),
    replies: [
      'Tell me the product name or category and I will check availability, sizing and fabric for you. What are you shopping for?',
      'Happy to help you find it. Any style, colour or size preference I should filter by?',
    ],
    chips: ['New arrivals', 'Best sellers', 'What sizes do you stock?'],
  },
];

const FALLBACKS = [
  {
    replies: [
      'I want to make sure I give you the right answer. Could you rephrase, or pick one of the options below?',
      'That one is a bit outside my usual script — let me hand you to a human agent, or try one of the shortcuts below.',
    ],
    chips: ['Talk to a human', 'Best deals', 'Return policy'],
  },
  {
    replies: [
      'Good question! Pick a topic below and I will dig into it properly.',
      'Let us narrow it down — choose one of these and I will take it from there.',
    ],
    chips: ['Track my order', 'Shipping times', 'Product availability'],
  },
];

/**
 * Replies the assistant is willing to give *before* sign-in. Anything that
 * would need account data is deflected to the login prompt.
 */
const LOGIN_NUDGE =
  "You'll need to log in first so I can pull up your account. Tap the Log in button below and I'll be right here.";
const SESSION_EXPIRED =
  "Your session has expired, so I can't reach your account just yet. Log in again and pick up where we left off.";

function composeReply(text, session) {
  const lower = text.toLowerCase().trim();

  /* Gated: no usable session -> always steer towards logging in. */
  if (session.status !== 'authed') {
    const expired = session.status === 'expired';
    const wantsLogin = includes(lower, 'log in', 'login', 'sign in', 'signin', 'log-in');
    if (wantsLogin) {
      return {
        reply: expired
          ? SESSION_EXPIRED
          : "Sure — tap the Log in button below and we'll get you sorted.",
        chips: ['What can you help with?'],
      };
    }
    if (/^(hi|hey|hello|yo|namaste|hii+)\b/.test(lower) && lower.split(/\s+/).length <= 3) {
      return {
        reply: expired
          ? SESSION_EXPIRED
          : "Hi! I'm KinMel Assistant. Log in and I can track your orders, handle returns and answer payment questions. Tap Log in below to start.",
        chips: ['What can you help with?'],
      };
    }
    return { reply: expired ? SESSION_EXPIRED : LOGIN_NUDGE, chips: ['What can you help with?'] };
  }

  for (const intent of INTENTS) {
    if (intent.test(lower)) {
      const reply = intent.replies[Math.floor(Math.random() * intent.replies.length)];
      return { reply, chips: intent.chips };
    }
  }
  const fallback = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  return {
    reply: fallback.replies[Math.floor(Math.random() * fallback.replies.length)],
    chips: fallback.chips,
  };
}

/** Opening line, personalised once we know who is talking. */
function greeting(session) {
  if (session.status === 'expired') return SESSION_EXPIRED;
  if (session.status !== 'authed') {
    return "Hi! I'm KinMel Assistant. Log in and I can track your orders, handle returns and answer payment questions — tap the Log in button below to start.";
  }
  const first = session.name ? session.name.trim().split(/\s+/)[0] : '';
  return first
    ? `Hi ${first}! You're signed in, so I can see your account. How can I help today?`
    : "Hi! You're signed in, so I can see your account. How can I help today?";
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */
export default function ChatbotButton() {
  const navigate = useNavigate();
  const location = useLocation();

  /* --- state ---------------------------------------------------- */
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chips, setChips] = useState(INTENTS[0].chips);

  const [corner, setCorner] = useState(readCorner);
  const [dragPos, setDragPos] = useState(null); // null => docked, not being dragged
  const [dragging, setDragging] = useState(false);

  const [unread, setUnread] = useState(0);
  const [showHint, setShowHint] = useState(() => !readHintSeen());

  const [session, setSession] = useState(readSession);
  /* Set when Express rejects the JWT; drives the "please log in" state. */
  const [loginRequired, setLoginRequired] = useState(false);

  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
    safeBottom: 0,
  }));
  const [size, setSize] = useState({ w: 72, h: 92 });

  const [messages, setMessages] = useState(() => [
    { id: 1, text: greeting(readSession()), sender: 'bot', time: stamp() },
  ]);

  /* --- refs ----------------------------------------------------- */
  const launcherRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const dragRef = useRef(null);
  const timersRef = useRef(new Set());
  const queueRef = useRef([]);
  const pumpingRef = useRef(false);
  const openRef = useRef(false);
  const msgIdRef = useRef(1);
  const sessionRef = useRef(session);
  /* Circuit breaker: one rejected/unreachable call and we answer locally until
     a later success proves the gateway is healthy again. */
  const onlineRef = useRef(true);
  const requireLoginRef = useRef(false);
  /* Recent turns handed to Express so the assistant keeps context. */
  const historyRef = useRef([]);

  /* `open` is needed inside the async reply pump; mirror it into a ref so the
     pump never has to be rebuilt (and never captures a stale value). */
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /* --- keep the session fresh ------------------------------------ */
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * Re-reads auth and, when the identity genuinely changed, restarts the
   * conversation with the matching greeting.
   */
  const syncSession = useCallback(() => {
    const next = readSession();
    setSession((prev) => {
      if (prev.status === next.status && prev.email === next.email) return prev;
      onlineRef.current = true;
      requireLoginRef.current = false;
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      queueRef.current = [];
      pumpingRef.current = false;
      historyRef.current = [];
      msgIdRef.current += 1;
      const id = msgIdRef.current;
      setMessages([{ id, text: greeting(next), sender: 'bot', time: stamp() }]);
      setChips(INTENTS[0].chips);
      setIsTyping(false);
      setUnread(0);
      setInput('');
      setLoginRequired(false);
      return next;
    });
  }, []);

  /*
   * Login and logout both happen in THIS tab: they write localStorage and then
   * navigate with react-router. Neither the `storage` event (other tabs only)
   * nor window `focus` (the tab never blurs) fires, and because the launcher
   * lives outside <Routes> a route change does not remount it — so its session
   * state would otherwise stay stale until a manual refresh.
   *
   * Three cheap signals cover every case:
   *   1. route changes  -> login/logout both navigate('/')
   *   2. a token poll   -> catches anything else written to storage
   *   3. storage/focus  -> other tabs and tab switching
   */
  useEffect(() => {
    let lastToken = safeStorage(AUTH_TOKEN_KEY);
    const poll = () => {
      const now = safeStorage(AUTH_TOKEN_KEY);
      if (now !== lastToken) {
        lastToken = now;
        syncSession();
      }
    };

    window.addEventListener('storage', syncSession);
    window.addEventListener('focus', syncSession);
    const interval = setInterval(poll, 1500);
    return () => {
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('focus', syncSession);
      clearInterval(interval);
    };
  }, [syncSession]);

  /* Logout and login both navigate, so the route is a reliable tell. */
  useEffect(() => {
    syncSession();
  }, [location.pathname, syncSession]);

  /* --- viewport + launcher measurement -------------------------- */
  useEffect(() => {
    const sync = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight, safeBottom: readSafeAreaBottom() });

    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);

  useLayoutEffect(() => {
    const el = launcherRef.current;
    if (!el) return undefined;

    const measure = () =>
      setSize((prev) => {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        return w === prev.w && h === prev.h ? prev : { w, h };
      });

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* --- one-time drag hint -------------------------------------- */
  useEffect(() => {
    if (!showHint) return undefined;
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, [showHint]);

  const dismissHint = useCallback(() => {
    setShowHint((wasVisible) => {
      if (wasVisible) markHintSeen();
      return false;
    });
  }, []);

  /* --- message plumbing ---------------------------------------- */
  const pushMessage = useCallback((text, sender) => {
    msgIdRef.current += 1;
    const entry = { id: msgIdRef.current, text, sender, time: stamp() };
    /* Keep a rolling window of turns to send along as context. */
    historyRef.current = [...historyRef.current, { sender, text }].slice(-20);
    setMessages((prev) => [...prev, entry]);
  }, []);

  /** Drains the reply queue one message at a time, typing indicator included. */
  const pumpQueue = useCallback(() => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    setIsTyping(true);

    const step = async () => {
      const next = queueRef.current.shift();
      if (next == null) {
        pumpingRef.current = false;
        setIsTyping(false);
        return;
      }

      /* Ask the Express gateway every time — it decides whether this session
         may chat at all. We only optimise how often we bother the network. */
      const live = sessionRef.current;
      let result = null;
      if (onlineRef.current) {
        result = await askExpress(next, live, historyRef.current);
      }

      const finish = (reply, chips) => {
        const timer = setTimeout(() => {
          timersRef.current.delete(timer);
          pushMessage(reply, 'bot');
          if (!openRef.current) setUnread((n) => n + 1);
          step();
        }, 150);
        timersRef.current.add(timer);
        if (chips) setChips(chips);
      };

      if (result?.kind === 'auth') {
        /* Express said the JWT is no good: stop talking and ask for a login. */
        onlineRef.current = false;
        requireLoginRef.current = true;
        setLoginRequired(true);
        setChips([]);
        finish(LOGIN_NUDGE, null);
        return;
      }

      if (result?.kind === 'reply') {
        finish(result.text, null);
        return;
      }

      /* Offline or the assistant service is down: fall back to the built-in
         help so the widget is never a dead end. One miss flips the flag so we
         stop retrying on every keystroke, and a success turns it back on. */
      if (result?.kind === 'down') {
        onlineRef.current = false;
        const { reply: localReply, chips: nextChips } = composeReply(next, live);
        finish(result.text && live.status === 'authed' ? `${result.text}\n\n${localReply}` : localReply, nextChips);
        return;
      }

      /* Gateway never reached (frontend offline): local help only. */
      const { reply: localReply, chips: nextChips } = composeReply(next, live);
      finish(localReply, nextChips);
    };

    step();
  }, [pushMessage]);

  const ask = useCallback(
    (text) => {
      const clean = text.trim();
      if (!clean) return;
      pushMessage(clean, 'user');
      queueRef.current.push(clean);
      pumpQueue();
    },
    [pushMessage, pumpQueue],
  );

  const handleSend = useCallback(() => {
    const value = input;
    if (!value.trim()) return;
    setInput('');
    ask(value);
  }, [ask, input]);

  const handleChip = useCallback(
    (text) => {
      setInput('');
      ask(text);
      inputRef.current?.focus();
    },
    [ask],
  );

  const isAuthed = session.status === 'authed';
  /* Chat is locked when Express has rejected the token (or we know there is
     none), so the user gets a login prompt instead of a failing request. */
  const chatLocked = loginRequired || !isAuthed;

  const resetChat = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    queueRef.current = [];
    pumpingRef.current = false;
    historyRef.current = [];
    setIsTyping(false);
    setInput('');
    setUnread(0);
    setChips(INTENTS[0].chips);
    msgIdRef.current += 1;
    setMessages([
      {
        id: msgIdRef.current,
        text: greeting(sessionRef.current),
        sender: 'bot',
        time: stamp(),
      },
    ]);
  }, []);

  /** Sends the visitor to the login page. If Express already rejected the token
      (or it is past its exp) the stale session is dropped first, otherwise
      Login.jsx would see a token and bounce them straight back home. */
  const goToLogin = useCallback(() => {
    if (requireLoginRef.current || sessionRef.current.status === 'expired') {
      clearSession();
      syncSession();
    }
    setOpen(false);
    navigate('/login');
  }, [navigate, syncSession]);

  /* Clear every pending timer when the component goes away. */
  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    },
    [],
  );

  /* --- scroll + focus on open ----------------------------------- */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping, open]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      if (window.matchMedia('(min-width: 640px)').matches) inputRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [open]);

  /* `unread` only ever grows while the panel is closed, so clearing it on
     toggle is always correct and keeps us out of a setState-in-effect. */
  const togglePanel = useCallback(() => {
    /* Cheap safety net: re-read auth every time the panel is opened. */
    syncSession();
    setUnread(0);
    setOpen((value) => !value);
  }, [syncSession]);

  /* Escape closes the panel. */
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /* --- dragging ------------------------------------------------- */
  const handlePointerDown = useCallback(
    (event) => {
      if (event.button != null && event.button > 0) return;

      const base = dragPos ?? dockPosition(corner, viewport, size);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: base.x,
        originY: base.y,
        moved: 0,
        startedAt: performance.now(),
        lastX: event.clientX,
        lastY: event.clientY,
        lastAt: performance.now(),
        vx: 0,
        vy: 0,
      };
      setDragging(true);
      dismissHint();
    },
    [corner, dismissHint, dragPos, size, viewport],
  );

  const handlePointerMove = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));

      /* Smoothed velocity so one jittery sample cannot flip the corner. */
      const now = performance.now();
      const dt = now - drag.lastAt;
      if (dt > 0) {
        drag.vx = drag.vx * 0.65 + ((event.clientX - drag.lastX) / dt) * 0.35;
        drag.vy = drag.vy * 0.65 + ((event.clientY - drag.lastY) / dt) * 0.35;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.lastAt = now;
      }

      /* A little slack past the edges keeps the launcher grabbable. */
      const slack = 14;
      setDragPos({
        x: clamp(drag.originX + dx, -slack, viewport.w - size.w + slack),
        y: clamp(drag.originY + dy, -slack, viewport.h - size.h + slack),
      });
    },
    [size, viewport],
  );

  const endDrag = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;

      dragRef.current = null;
      setDragging(false);

      const elapsed = performance.now() - drag.startedAt;
      const isTap = drag.moved < TAP_SLOP && elapsed < TAP_TIME;

      if (isTap) {
        setDragPos(null);
        togglePanel();
        return;
      }

      const clientX = event?.clientX ?? drag.lastX;
      const clientY = event?.clientY ?? drag.lastY;
      const next = resolveCorner(clientX, clientY, drag.vx, drag.vy, viewport);

      setCorner(next);
      setDragPos(null);
      saveCorner(next);
      /* Moving the launcher is a clear "let us go back to browsing" signal. */
      setOpen(false);
    },
    [togglePanel, viewport],
  );

  const cancelDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    setDragPos(null);
  }, []);

  /* Listeners live only for the duration of a drag. */
  useEffect(() => {
    if (!dragging) return undefined;

    const onMove = (event) => handlePointerMove(event);
    const onUp = (event) => endDrag(event);
    const onCancel = () => cancelDrag();
    /* Releasing outside the window never fires pointerup — recover here. */
    const onBlur = () => cancelDrag();

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelDrag, dragging, endDrag, handlePointerMove]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePanel();
    }
  }, [togglePanel]);

  const handleContextMenu = useCallback((event) => {
    /* A long press while dragging must not open the browser menu. */
    if (dragRef.current) event.preventDefault();
  }, []);

  /* --- geometry -------------------------------------------------- */
  const docked = dockPosition(corner, viewport, size);
  const pos = dragPos ?? docked;

  const { w: vw, h: vh, safeBottom } = viewport;
  const isMobile = vw < MOBILE_BREAKPOINT;
  const launcherOnLeft = isLeftCorner(corner);
  const launcherOnTop = isTopCorner(corner);

  let panelStyle;
  if (isMobile) {
    /* Bottom sheet. If the launcher is docked at the bottom the sheet lifts
       above it, otherwise it uses the normal bottom inset. Either way the
       height is derived from the space that is actually left, so the sheet can
       never be pushed off the top of the screen. */
    const wanted = launcherOnTop
      ? safeBottom + PANEL_GAP
      : EDGE_BOTTOM + safeBottom + size.h + 8;
    const bottom = clamp(wanted, PANEL_GAP, Math.round(vh * 0.4));
    const available = vh - bottom - PANEL_GAP;
    panelStyle = {
      left: PANEL_GAP,
      right: PANEL_GAP,
      bottom,
      height: Math.min(Math.round(vh * 0.72), 560, Math.max(160, available)),
      transformOrigin: 'center bottom',
    };
  } else {
    const width = Math.min(PANEL_W, Math.max(260, vw - PANEL_GAP * 2));
    const height = Math.min(PANEL_H, Math.max(320, vh - PANEL_GAP * 2));

    /* Sit directly beside the launcher, `BESIDE_GAP` away from it. */
    const beside = launcherOnLeft
      ? pos.x + size.w + BESIDE_GAP
      : pos.x - width - BESIDE_GAP;
    const room = launcherOnLeft
      ? beside + width <= vw - PANEL_GAP
      : beside >= PANEL_GAP;

    /* Should there ever be no room beside (very narrow window, zoomed page),
       fall back to the opposite edge so the launcher is never covered. */
    const left = room
      ? clamp(beside, PANEL_GAP, Math.max(PANEL_GAP, vw - PANEL_GAP - width))
      : launcherOnLeft
        ? vw - PANEL_GAP - width
        : PANEL_GAP;

    /* Bottom-docked panels line their bottom edge up with the launcher's, top
       ones line up their top edge, so the two read as a single unit. */
    const rawTop = launcherOnTop ? pos.y : pos.y + size.h - height;
    const top = clamp(rawTop, PANEL_GAP, Math.max(PANEL_GAP, vh - PANEL_GAP - height));

    /* It animates out of the edge facing the launcher. */
    const origin = `${launcherOnLeft ? 'left' : 'right'} ${launcherOnTop ? 'top' : 'bottom'}`;
    panelStyle = { left, top, width, height, transformOrigin: origin };
  }

  const panelTransition = isMobile
    ? `left 300ms ${PANEL_EASE}, right 300ms ${PANEL_EASE}, bottom 300ms ${PANEL_EASE}, height 300ms ${PANEL_EASE}`
    : `left 300ms ${PANEL_EASE}, right 300ms ${PANEL_EASE}, top 300ms ${PANEL_EASE}`;

  return (
    <>
      <style>{`
        @keyframes kinmel-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes kinmel-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: .45; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes kinmel-panel-in {
          from { opacity: 0; transform: scale(.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes kinmel-sheet-in {
          from { opacity: 0; transform: translateY(30px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes kinmel-hint-in {
          from { opacity: 0; transform: translateY(6px) scale(.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes kinmel-halo {
          0%   { transform: scale(.85); opacity: .55; }
          70%  { transform: scale(1.6); opacity: 0; }
          100% { transform: scale(1.6); opacity: 0; }
        }

        .kinmel-dot-1 { animation: kinmel-dot 1.3s ease-in-out infinite; }
        .kinmel-dot-2 { animation: kinmel-dot 1.3s ease-in-out infinite .18s; }
        .kinmel-dot-3 { animation: kinmel-dot 1.3s ease-in-out infinite .36s; }
        .kinmel-halo  { animation: kinmel-halo 2.4s ease-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .kinmel-dot-1, .kinmel-dot-2, .kinmel-dot-3, .kinmel-halo { animation: none !important; }
        }
      `}</style>

      {/* ============================ Launcher ============================ */}
      <div
        className="fixed left-0 top-0 z-[70] touch-none select-none"
        style={{
          transform: `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`,
          transition: dragging ? 'none' : SNAP_EASE,
        }}
      >
        <div
          ref={launcherRef}
          role="button"
          tabIndex={0}
          aria-label={open ? 'Close KinMel assistant' : 'Open KinMel assistant'}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-haspopup="dialog"
          onPointerDown={handlePointerDown}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          onContextMenu={handleContextMenu}
          onKeyDown={handleKeyDown}
          className="group relative flex cursor-grab touch-none select-none flex-col items-center gap-1 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 focus-visible:ring-offset-4 active:cursor-grabbing"
        >
          {/* Drag hint — shown once, ever. */}
          {showHint && (
            <span
              className="pointer-events-none absolute z-10 flex w-max items-center gap-1.5 whitespace-nowrap rounded-full bg-neutral-900/90 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur"
              style={{
                animation: 'kinmel-hint-in .4s ease-out both',
                ...(launcherOnTop
                  ? { top: '100%', marginTop: 8 }
                  : { bottom: '100%', marginBottom: 8 }),
                ...(launcherOnLeft ? { left: -8 } : { right: -8 }),
              }}
            >
              <Move size={12} strokeWidth={2.2} />
              Drag me to a corner
            </span>
          )}

          <div
            className="relative"
            style={{ animation: dragging ? 'none' : 'kinmel-float 3s ease-in-out infinite' }}
          >
            {/* Halo only when there is something unread. */}
            {unread > 0 && (
              <span
                className="kinmel-halo pointer-events-none absolute inset-0 rounded-full bg-amber-400/40"
                aria-hidden="true"
              />
            )}

            <div
              className="relative grid h-[72px] w-[72px] place-items-center rounded-full bg-black text-white shadow-[0_12px_32px_rgba(0,0,0,0.35)] ring-1 ring-black/10 transition-transform duration-300 group-hover:scale-105"
              style={{ transition: dragging ? 'none' : 'transform 300ms ease' }}
            >
              <span className="transition-transform duration-300" style={{ animation: 'bounceIn .3s ease-out' }}>
                <Bot size={34} strokeWidth={1.9} />
              </span>

              {/* Green presence dot while idle, unread counter otherwise. */}
              {unread > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[20px] place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              ) : (
                <span className="absolute right-1 top-1 flex h-4 w-4">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="h-4 w-4 rounded-full border-2 border-white bg-green-500" />
                </span>
              )}
            </div>
          </div>

          <span className="whitespace-nowrap text-xs font-medium text-gray-600">Assistant</span>
        </div>
      </div>

      {/* ============================= Panel ============================== */}
      {open && (
        <div
          id={PANEL_ID}
          role="dialog"
          aria-label="KinMel Assistant chat"
          className={`fixed z-[65] flex flex-col overflow-hidden border border-neutral-200/80 bg-white shadow-[0_24px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl ${
            isMobile ? 'rounded-[26px]' : 'rounded-[26px]'
          }`}
          style={{
            ...panelStyle,
            transition: panelTransition,
            animation: `${isMobile ? 'kinmel-sheet-in' : 'kinmel-panel-in'} ${
              isMobile ? '.34s' : '.28s'
            } ${PANEL_EASE} both`,
          }}
        >
          {/* Header */}
          <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-neutral-900 via-black to-neutral-800 p-4 text-white">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl"
            />
            <div className="relative flex items-center gap-3">
              <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/20">
                <Bot size={20} strokeWidth={2} />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-black bg-green-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-semibold leading-none">
                  KinMel Assistant
                  <Sparkles size={12} className="shrink-0 text-amber-300" />
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-white/60">
                  {chatLocked ? (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      <span className="truncate">
                        {loginRequired || session.status === 'expired'
                          ? 'Session expired · please log in'
                          : 'Log in to chat'}
                      </span>
                    </>
                  ) : (
                    <>
                      <UserRound size={11} className="shrink-0 text-emerald-400" />
                      <span className="truncate">{session.name || session.email || 'Signed in'}</span>
                    </>
                  )}
                </p>
              </div>
              {chatLocked && (
                <button
                  type="button"
                  onClick={goToLogin}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-neutral-200"
                >
                  <LogIn size={13} strokeWidth={2.4} />
                  {session.status === 'expired' ? 'Log in again' : 'Log in'}
                </button>
              )}
              <button
                type="button"
                onClick={resetChat}
                aria-label="Clear conversation"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <RotateCcw size={15} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex flex-col ${
                  message.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[85%] break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
                    message.sender === 'user'
                      ? 'rounded-tr-sm bg-black text-white'
                      : 'rounded-tl-sm border border-neutral-100 bg-neutral-100 text-neutral-800'
                  }`}
                >
                  {message.text}
                </div>
                <span
                  className={`mt-1 px-1 text-[10px] tabular-nums text-neutral-400 ${
                    message.sender === 'user' ? 'self-end' : 'self-start'
                  }`}
                >
                  {message.time}
                </span>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-neutral-100 bg-neutral-100 px-4 py-3.5">
                <span className="kinmel-dot-1 h-1.5 w-1.5 rounded-full bg-neutral-400" />
                <span className="kinmel-dot-2 h-1.5 w-1.5 rounded-full bg-neutral-400" />
                <span className="kinmel-dot-3 h-1.5 w-1.5 rounded-full bg-neutral-400" />
              </div>
            )}
          </div>

          {/* Quick replies */}
          {!isTyping && chips?.length > 0 && (
            <div className="shrink-0 border-t border-neutral-100 px-3 pt-3">
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleChip(chip)}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer — gated until there is a session */}
          <div className="shrink-0 border-t border-neutral-100 bg-white p-3">
            {chatLocked ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={goToLogin}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
                >
                  <LogIn size={15} strokeWidth={2.4} />
                  {session.status === 'expired' ? 'Log in again to continue' : 'Log in to chat'}
                </button>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSend();
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-dashed border-neutral-200 bg-neutral-50 p-1"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask me anything first..."
                    aria-label="Message"
                    autoComplete="off"
                    className="w-full min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    aria-label="Send message"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-300 text-white transition-all hover:bg-neutral-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send size={16} strokeWidth={2} />
                  </button>
                </form>
                <p className="text-center text-[10px] text-neutral-400">
                  {loginRequired
                    ? 'Your session ended — log in to keep chatting'
                    : 'Sign in to chat with the assistant'}
                </p>
              </div>
            ) : (
              <>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleSend();
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-100 bg-neutral-50 p-1 transition-colors focus-within:border-neutral-300 focus-within:bg-white"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Type a message..."
                    aria-label="Message"
                    autoComplete="off"
                    className="w-full min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    aria-label="Send message"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black text-white transition-all hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Send size={16} strokeWidth={2} />
                  </button>
                </form>
                <p className="mt-2 text-center text-[10px] text-neutral-400">
                  Powered by KinMel Assistant · press Esc to close
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Local 12-hour clock, e.g. "09:41". */
function stamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}