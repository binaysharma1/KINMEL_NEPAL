import express from 'express';
import axios from 'axios';
import verifyToken from '../middleware/verifyToken.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import { chatSchema } from '../middleware/validate.js';
import userModel from '../models/userModel.js';

const chatRoute = express.Router();

/**
 * Where the FastAPI assistant lives. Read per request rather than at import
 * time so the target stays configurable at runtime (and in tests).
 */
const upstreamUrl = () =>
  `${(process.env.FASTAPI_URL || 'http://localhost:8000').replace(/\/+$/, '')}${
    process.env.FASTAPI_CHAT_PATH || '/fastapi/v1/chat'
  }`;

/** Model calls are slow; don't let a hung request pin an Express worker. */
const upstreamTimeout = () => Number(process.env.FASTAPI_TIMEOUT_MS || 30000);

/**
 * The name/email lookup only personalises the prompt, so it must never hold up
 * a reply. If Mongo is slow or down we simply chat without it.
 */
const profileTimeout = () => Number(process.env.CHAT_PROFILE_TIMEOUT_MS || 1500);

async function loadProfile(userId) {
  // `.catch` on the loser stops a late rejection becoming an unhandled rejection.
  const lookup = userModel
    .findById(userId)
    .select('name email')
    .lean()
    .exec()
    .catch(() => null);

  const user = await Promise.race([
    lookup,
    new Promise((resolve) => setTimeout(() => resolve(null), profileTimeout())),
  ]);

  return user ? { name: user.name, email: user.email } : {};
}

/**
 * POST /api/chat
 *
 * Auth: the JWT is the gate. No token or an invalid/expired one means the
 * client is told to log in and FastAPI is never contacted.
 * Once the token is verified, the turn is forwarded to the FastAPI assistant.
 */
chatRoute.post('/', chatLimiter, verifyToken, chatSchema, async (req, res) => {
  const userId = req.userId;
  const { message, history = [], sessionId } = req.body;

  try {
    // Identity comes from the verified token, never from the request body.
    const profile = await loadProfile(userId);

    console.log('💬 CHAT request:', { userId, chars: message.length, history: history.length });

    const upstream = await axios.post(
      upstreamUrl(),
      {
        message,
        history,
        sessionId: sessionId || userId,
        user: { id: userId, ...profile },
      },
      {
        timeout: upstreamTimeout(),
        headers: { 'Content-Type': 'application/json' },
        // Never leak the user's JWT to the model service.
        validateStatus: (status) => status >= 200 && status < 300,
      },
    );

    const data = upstream.data || {};
    const reply = data.reply ?? data.message ?? data.answer ?? data.data?.reply;

    if (typeof reply !== 'string' || !reply.trim()) {
      console.error('⚠️ FastAPI returned no usable reply:', data);
      return res.status(502).json({
        success: false,
        code: 'EMPTY_REPLY',
        message: 'The assistant gave an empty response. Please try again.',
      });
    }

    console.log('✅ CHAT reply sent:', { userId, chars: reply.length });
    return res.json({ success: true, reply });
  } catch (error) {
    const code = error.code || error.response?.status;
    console.error('❌ Chat upstream error:', code || error.message);

    if (error.response) {
      // FastAPI answered with an error — surface its status, not our internals.
      return res.status(502).json({
        success: false,
        code: 'UPSTREAM_ERROR',
        message: 'The assistant is having trouble right now. Please try again.',
      });
    }

    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        success: false,
        code: 'UPSTREAM_TIMEOUT',
        message: 'The assistant took too long to respond. Please try again.',
      });
    }

    // ECONNREFUSED / ENOTFOUND / DNS — the assistant service is not up.
    return res.status(503).json({
      success: false,
      code: 'ASSISTANT_UNAVAILABLE',
      message: 'The assistant is currently unavailable.',
    });
  }
});

/** Cheap liveness probe so the frontend can tell "down" from "broken". */
chatRoute.get('/health', (_req, res) => {
  res.json({ success: true, upstream: upstreamUrl() });
});

export default chatRoute;