import { initBotId } from "botid/client/core";

/**
 * Vercel BotID — invisible CAPTCHA on high-value public endpoints.
 * Paths listed here are page routes that invoke a protected server action.
 * The server action itself must call `checkBotId()` from `botid/server`.
 *
 * Free tier (Basic) runs by default. Deep Analysis toggle lives in
 * Vercel Firewall → Rules → Vercel BotID Deep Analysis.
 */
initBotId({
  protect: [
    { path: "/login", method: "POST" },
    { path: "/register", method: "POST" },
    { path: "/forgot-password", method: "POST" },
    { path: "/student/bookings/new", method: "POST" },
    { path: "/teach/apply", method: "POST" },
    { path: "/contact", method: "POST" },
  ],
});
