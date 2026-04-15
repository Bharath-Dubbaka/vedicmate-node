// src/routes/premium.js
// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM / SUBSCRIPTION ROUTES
//
// Flow:
//   1. User buys subscription in app via RevenueCat SDK (frontend)
//   2. RevenueCat sends webhook to POST /api/premium/webhook on purchase/renewal/cancel
//   3. We update user.premium in DB
//   4. GET /api/premium/status returns current subscription state to frontend
//   5. GET /api/premium/swipes returns today's swipe count + limit
//
// RevenueCat Products (configure in RevenueCat dashboard):
//   - vedicmate_premium_monthly  → $X/month
//   - vedicmate_premium_annual   → $Y/year (discounted)
//
// RevenueCat Entitlement:
//   - "premium" entitlement → grants access to premium features
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { protect } = require("../middleware/auth");

// ── Helper: parse RevenueCat plan from product identifier ────────────────────
const getPlanFromProductId = (productId = "") => {
  if (productId.includes("annual")) return "annual";
  if (productId.includes("monthly")) return "monthly";
  return "monthly"; // fallback
};

// ── Helper: compute expiry from plan ────────────────────────────────────────
const getExpiryFromPlan = (plan, fromDate = new Date()) => {
  const d = new Date(fromDate);
  if (plan === "annual") {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/premium/webhook
//
// RevenueCat webhook — fires on:
//   INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, SUBSCRIBER_ALIAS
//
// Set webhook URL in RevenueCat dashboard:
//   https://your-domain.com/api/premium/webhook
//
// IMPORTANT: Add webhook secret to .env as REVENUECAT_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────────────────
router.post("/webhook", async (req, res) => {
  try {
    // Verify webhook secret
    const secret = req.headers["authorization"];
    if (
      process.env.REVENUECAT_WEBHOOK_SECRET &&
      secret !== process.env.REVENUECAT_WEBHOOK_SECRET
    ) {
      console.warn("[PREMIUM] Webhook: invalid secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const event = req.body;
    const eventType = event.event?.type;
    const appUserId = event.event?.app_user_id; // This is the userId we set in RevenueCat
    const productId = event.event?.product_id;
    const expiresAt = event.event?.expiration_at_ms
      ? new Date(event.event.expiration_at_ms)
      : null;

    console.log(`[PREMIUM] Webhook: ${eventType} for user: ${appUserId}`);

    if (!appUserId) {
      return res.status(400).json({ error: "Missing app_user_id" });
    }

    const user = await User.findById(appUserId);
    if (!user) {
      console.warn(`[PREMIUM] Webhook: user not found: ${appUserId}`);
      return res.status(404).json({ error: "User not found" });
    }

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE": {
        const plan = getPlanFromProductId(productId);
        user.premium = {
          isActive: true,
          plan,
          expiresAt: expiresAt || getExpiryFromPlan(plan),
          revenueCatId: appUserId,
        };
        await user.save();
        console.log(`[PREMIUM] Activated ${plan} for: ${appUserId}`);
        break;
      }

      case "CANCELLATION":
      case "EXPIRATION":
      case "BILLING_ISSUE": {
        // Don't immediately deactivate on cancel — let it expire naturally
        // Only deactivate on EXPIRATION or if expiresAt has passed
        if (
          eventType === "EXPIRATION" ||
          (expiresAt && new Date() > expiresAt)
        ) {
          user.premium.isActive = false;
          await user.save();
          console.log(`[PREMIUM] Deactivated for: ${appUserId}`);
        } else {
          console.log(
            `[PREMIUM] Cancelled but not yet expired for: ${appUserId}`
          );
        }
        break;
      }

      default:
        console.log(`[PREMIUM] Unhandled event type: ${eventType}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[PREMIUM] Webhook error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/premium/status
//
// Returns current subscription status for the logged-in user.
// Frontend uses this to gate premium features.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/status", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "premium swipeTracking boost"
    );
    const premiumActive = user.isPremium();

    // Auto-deactivate if expired
    if (user.premium?.isActive && !premiumActive) {
      await User.findByIdAndUpdate(req.user._id, {
        "premium.isActive": false,
      });
    }

    const swipeStatus = user.canSwipe();
    const boostActive =
      !!user.boost?.active &&
      user.boost?.expiresAt &&
      new Date(user.boost.expiresAt) > new Date();

    return res.json({
      success: true,
      premium: {
        isActive: premiumActive,
        plan: premiumActive ? user.premium?.plan ?? null : null,
        expiresAt: premiumActive ? user.premium?.expiresAt ?? null : null,
      },
      swipes: {
        allowed: swipeStatus.allowed,
        remaining: swipeStatus.remaining,
        limit: swipeStatus.limit,
        isPremium: premiumActive,
      },
      boost: {
        active: boostActive,
        expiresAt: boostActive ? user.boost.expiresAt : null,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/premium/verify
//
// Called from frontend after RevenueCat purchase completes.
// We fetch the customer info from RevenueCat API to verify and activate.
// This is a fallback in case webhook is delayed.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/verify", protect, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { devMode } = req.body;

    // Dev mode: grant 30-day premium for Expo Go testing (no real RC call)
    if (devMode || !process.env.REVENUECAT_API_KEY) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await User.findByIdAndUpdate(userId, {
        premium: {
          isActive: true,
          plan: "monthly",
          expiresAt,
          revenueCatId: userId,
        },
      });
      return res.json({
        success: true,
        premium: { isActive: true, plan: "monthly", expiresAt },
        devMode: true,
      });
    }

    const rcRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!rcRes.ok)
      return res.json({ success: true, premium: { isActive: false } });

    const rcData = await rcRes.json();
    const ent = rcData.subscriber?.entitlements?.["premium"];

    if (ent && new Date() < new Date(ent.expires_date)) {
      const plan = ent.product_identifier?.includes("annual")
        ? "annual"
        : "monthly";
      await User.findByIdAndUpdate(userId, {
        premium: {
          isActive: true,
          plan,
          expiresAt: new Date(ent.expires_date),
          revenueCatId: userId,
        },
      });
      return res.json({
        success: true,
        premium: { isActive: true, plan, expiresAt: ent.expires_date },
      });
    }

    return res.json({ success: true, premium: { isActive: false } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/premium/boost
//
// Activates a 30-minute profile boost for premium users.
// Limit: 1 boost per day (resets at UTC midnight).
// Sets user.boost = { active: true, expiresAt: now+30min, usedAt: today }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/boost", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("premium boost");

    if (!user.isPremium()) {
      return res.status(403).json({
        success: false,
        requiresPremium: true,
        message: "Profile boost is a Premium feature",
      });
    }

    const now = new Date();

    // ── Week key helper — "2026-W16" format ──────────────────────────────
    const getWeekKey = (date) => {
      const d = new Date(date);
      const startOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil(
        ((d - startOfYear) / 86400000 + startOfYear.getUTCDay() + 1) / 7
      );
      return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    };

    const thisWeek = getWeekKey(now);

    // Check if already used boost this week
    if (user.boost?.usedAt && getWeekKey(user.boost.usedAt) === thisWeek) {
      // Check if current boost is still active
      const boostStillActive =
        user.boost?.active && new Date(user.boost.expiresAt) > now;

      if (boostStillActive) {
        const minsLeft = Math.ceil(
          (new Date(user.boost.expiresAt) - now) / 60000
        );
        return res.status(400).json({
          success: false,
          message: `Boost already active — ${minsLeft} min remaining`,
        });
      }

      // Boost expired but already used this week
      // Calculate next Monday UTC
      const nextMonday = new Date(now);
      const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
      nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
      nextMonday.setUTCHours(0, 0, 0, 0);

      return res.status(400).json({
        success: false,
        message: "You've used your weekly boost. Come back next week! 🌙",
        resetAt: nextMonday.toISOString(),
      });
    }

    // Activate boost — 30 minutes
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    await User.findByIdAndUpdate(req.user._id, {
      boost: {
        active: true,
        expiresAt,
        usedAt: thisWeek, // ← store week key, not date string
      },
    });

    console.log(
      `[BOOST] Activated for user ${req.user._id}, expires ${expiresAt}`
    );

    // Next Monday for reset message
    const nextMonday = new Date(now);
    const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
    nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
    nextMonday.setUTCHours(0, 0, 0, 0);

    return res.json({
      success: true,
      message: "Your profile is boosted for 30 minutes! 🚀",
      expiresAt,
      resetsAt: nextMonday.toISOString(),
    });
  } catch (err) {
    console.error("[BOOST] Error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
