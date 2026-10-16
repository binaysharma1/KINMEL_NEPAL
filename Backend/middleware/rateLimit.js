import rateLimit from "express-rate-limit";

// Create rate limiter
// Relaxed for local dev (NODE_ENV is unset locally); strict in production.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 100, // 5 in prod, 100 locally
  message: {
    success: false,
    message: "Too many requests, please try again later."
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter limiter for all auth endpoints (login/register/admin) against brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 60,
  message: {
    success: false,
    message: "Too many login attempts, please try again later."
  },
  standardHeaders: true,
  legacyHeaders: false
});

export default limiter;
export { authLimiter };

// Chat is authenticated but still expensive per call, so it gets its own budget.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'production' ? 20 : 60,
  message: {
    success: false,
    message: "You're sending messages too quickly. Give it a moment."
  },
  standardHeaders: true,
  legacyHeaders: false
});

export { chatLimiter };