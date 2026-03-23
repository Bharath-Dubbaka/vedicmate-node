/**
 * src/routes/matching.js
 * SPRINT 3: Swipe limit enforcement added to like + pass routes.
 * Free users: 20 swipes/day (UTC reset). Premium: unlimited.
 */

const express = require("express");
const User = require("../models/User");
const Match = require("../models/Match");
const { protect } = require("../middleware/auth");
const { calculateGunaMilan } = require("../engines/gunaMilan");
const { NAKSHATRAS } = require("../engines/nakshatraLookup");

const router = express.Router();
router.use(protect);

// ─────────────────────────────────────────────────────────
// Helper: hydrate full Nakshatra object from stored kundli
//
// Why we store nakshatraIndex and re-hydrate:
//   The DB stores only the index (0-26). At runtime we look
//   up the full object from NAKSHATRAS[] which has all the
//   fields gunaMilan needs (animal, gana, nadi, vashya, etc.)
// ─────────────────────────────────────────────────────────
const getNakshatraObj = (kundli) => {
   if (!kundli) return null;
   return NAKSHATRAS[kundli.nakshatraIndex];
};

// ─────────────────────────────────────────────────────────
// Helper: canonical Guna Milan calculation
//
// ALWAYS calls calculateGunaMilan(femaleNakshatra, maleNakshatra)
// regardless of which user is "me" or "them".
//
// @param userA - full User doc or lean object (has .gender, .kundli)
// @param userB - full User doc or lean object (has .gender, .kundli)
// @returns gunaResult from calculateGunaMilan, or null if data missing
//
// Edge cases:
//   - If both are same gender → falls back to (userA, userB) order
//     (non-traditional but better than crashing)
//   - If either kundli is missing → returns null
// ─────────────────────────────────────────────────────────
const getCanonicalGuna = (userA, userB) => {
   const nakA = getNakshatraObj(userA.kundli);
   const nakB = getNakshatraObj(userB.kundli);
   if (!nakA || !nakB) return null;

   // Determine bride (female) and groom (male)
   // Traditional rule: female nakshatra = param 1, male = param 2
   let brideNak, groomNak;

   if (userA.gender === "female" && userB.gender === "male") {
      brideNak = nakA;
      groomNak = nakB;
   } else if (userA.gender === "male" && userB.gender === "female") {
      brideNak = nakB;
      groomNak = nakA;
   } else {
      // Same gender or "other" — no traditional direction, use A→B
      // Both users will still see the same score since we're consistent
      brideNak = nakA;
      groomNak = nakB;
   }

   return calculateGunaMilan(brideNak, groomNak);
};

// ─────────────────────────────────────────────────────────
// Helper: send Expo push notification
// Silently skips if token missing or invalid format
// ─────────────────────────────────────────────────────────
const sendPushNotification = async (pushToken, title, body, data = {}) => {
   if (!pushToken || !pushToken.startsWith("ExponentPushToken")) return;
   try {
      await fetch("https://exp.host/--/api/v2/push/send", {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({
            to: pushToken,
            title,
            body,
            data,
            sound: "default",
         }),
      });
   } catch (err) {
      console.error("Push notification error:", err.message);
   }
};

// ─────────────────────────────────────────────────────────
// SPRINT 3 Helper: check swipe allowance for a user
// Reads premium + swipeTracking from DB fresh each time.
// Returns { allowed, remaining, limit, isPremium }
// ─────────────────────────────────────────────────────────
const checkSwipeLimit = async (userId) => {
   const user = await User.findById(userId).select("premium swipeTracking");
   if (!user)
      return { allowed: false, remaining: 0, limit: 20, isPremium: false };
   return user.canSwipe();
};

// ─────────────────────────────────────────────────────────
// Helper: next UTC midnight timestamp (for reset info in response)
// ─────────────────────────────────────────────────────────
const getNextUTCMidnight = () => {
   const now = new Date();
   return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
   ).toISOString();
};

// ─────────────────────────────────────────────────────────
// Helper: top 3 highest-scoring kootas for card highlights
// ─────────────────────────────────────────────────────────
const getTopHighlights = (breakdown) => {
   return Object.entries(breakdown)
      .map(([key, val]) => ({
         name: val.name,
         score: val.score,
         max: val.max,
         detail: val.detail,
         percentage: Math.round((val.score / val.max) * 100),
      }))
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 3);
};

// ─────────────────────────────────────────────────────────
// GET /api/matching/discover
//
// Returns a batch of compatible profiles for the swipe deck.
// SPRINT 3: Includes boost field in candidate select so boosted
// profiles can be sorted to the top.
// ─────────────────────────────────────────────────────────
router.get("/discover", async (req, res) => {
   try {
      const me = await User.findById(req.user._id).select(
         "kundli gender preferences likedUsers passedUsers age",
      );

      if (!me.kundli) {
         return res.status(400).json({
            success: false,
            message: "Complete onboarding before discovering matches",
         });
      }

      const { limit = 10, cursor } = req.query;
      const { minAge, maxAge, minGunaScore } = me.preferences;

      // ── Build candidate query ─────────────────────
      // Exclude: myself, people I already liked, people I already passed
      const excludeIds = [req.user._id, ...me.likedUsers, ...me.passedUsers];

      const query = {
         _id: { $nin: excludeIds, ...(cursor && { $gt: cursor }) },
         onboardingComplete: true,
         isActive: true,
         kundli: { $exists: true },
         age: { $gte: minAge, $lte: maxAge },
      };

      // Vedic calculation requires female nakshatra as param 1, male as param 2.
      // So we enforce opposite-gender matching: male users see female profiles only,
      // female users see male profiles only. This ensures correct Guna Milan direction.
      const requiredGender =
         me.gender === "male"
            ? "female"
            : me.gender === "female"
              ? "male"
              : null;

      if (requiredGender) {
         query.gender = requiredGender;
      }

      // Mutual filter: only show users who would match with me by gender
      if (requiredGender) {
         query["preferences.genderPref"] = { $in: [me.gender, "both"] };
      }

      // SPRINT 3: Added "boost" to select so we can sort boosted profiles first
      const candidates = await User.find(query)
         .select("name age gender kundli photos bio lookingFor boost")
         .limit(parseInt(limit) * 3)
         .lean();

      // ── Calculate canonical Guna for each candidate ───
      // Using getCanonicalGuna() ensures female is always param 1,
      // so the score is identical regardless of who is viewing
      const results = [];

      for (const candidate of candidates) {
         // Pass both users — getCanonicalGuna resolves the direction internally
         const gunaResult = getCanonicalGuna(me, candidate);
         if (!gunaResult) continue;

         // Filter out profiles below the user's minimum guna threshold
         if (gunaResult.totalScore < minGunaScore) continue;

         // SPRINT 3: Check if this candidate has an active boost
         const isBoosted =
            candidate.boost?.active &&
            candidate.boost?.expiresAt &&
            new Date(candidate.boost.expiresAt) > new Date();

         results.push({
            user: {
               id: candidate._id,
               name: candidate.name,
               age: candidate.age,
               bio: candidate.bio,
               photos: candidate.photos || [],
               lookingFor: candidate.lookingFor,
               // SPRINT 3: Expose boost flag to frontend (optional badge)
               isBoosted: isBoosted || false,
               cosmicCard: {
                  nakshatra: `${candidate.kundli.nakshatraSymbol} ${candidate.kundli.nakshatra}`,
                  rashi: candidate.kundli.rashi,
                  pada: candidate.kundli.pada,
                  animal: candidate.kundli.animal,
                  gana: candidate.kundli.gana,
                  nadi: candidate.kundli.nadi,
                  varna: candidate.kundli.varna,
                  vashya: candidate.kundli.vashya,
                  lordPlanet: candidate.kundli.lordPlanet,
                  ganaTitle:
                     candidate.kundli.gana === "Deva"
                        ? "Divine Soul ✨"
                        : candidate.kundli.gana === "Manushya"
                          ? "Human Heart 🤝"
                          : "Fierce Spirit 🔥",
               },
            },
            compatibility: {
               totalScore: gunaResult.totalScore,
               totalMax: 36,
               percentage: gunaResult.percentage,
               verdict: gunaResult.verdict,
               verdictEmoji: gunaResult.verdictEmoji,
               verdictColor: gunaResult.verdictColor,
               highlights: getTopHighlights(gunaResult.breakdown),
               breakdown: gunaResult.breakdown,
               doshas: gunaResult.doshas,
               hasDoshas: gunaResult.doshas.length > 0,
               doshaCount: gunaResult.doshas.length,
            },
            // Internal sort flag — removed before client sees it below
            _isBoosted: isBoosted,
         });

         if (results.length >= parseInt(limit)) break;
      }

      // SPRINT 3: Boosted profiles bubble to top, then sort by guna score
      results.sort((a, b) => {
         if (a._isBoosted && !b._isBoosted) return -1; // boosted first
         if (!a._isBoosted && b._isBoosted) return 1;
         return b.compatibility.totalScore - a.compatibility.totalScore; // then by guna
      });

      // Clean up internal flag before sending to client
      results.forEach((r) => delete r._isBoosted);

      return res.status(200).json({
         success: true,
         count: results.length,
         profiles: results,
      });
   } catch (err) {
      console.error("Discover error:", err);
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/swipe-status
// SPRINT 3: Frontend polls this to show remaining swipes in UI
// ─────────────────────────────────────────────────────────
router.get("/swipe-status", async (req, res) => {
   try {
      const user = await User.findById(req.user._id).select(
         "premium swipeTracking",
      );
      const status = user.canSwipe();

      return res.json({
         success: true,
         allowed: status.allowed,
         remaining: status.remaining === Infinity ? null : status.remaining,
         limit: status.limit === Infinity ? null : status.limit,
         isPremium: status.isPremium,
         resetAt: getNextUTCMidnight(),
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/compatibility/:userId
// Full canonical Guna Milan report between me and any user.
// Used when tapping "View Full Kundli" on a profile card.
// Returns the same score regardless of who calls it.
// ─────────────────────────────────────────────────────────
router.get("/compatibility/:userId", async (req, res) => {
   try {
      const me = await User.findById(req.user._id).select("kundli name gender");
      const them = await User.findById(req.params.userId).select(
         "kundli name age gender photos bio",
      );

      if (!them) {
         return res
            .status(404)
            .json({ success: false, message: "User not found" });
      }
      if (!me.kundli || !them.kundli) {
         return res.status(400).json({
            success: false,
            message: "One or both users have incomplete Kundli",
         });
      }

      // getCanonicalGuna resolves bride/groom direction automatically
      const gunaResult = getCanonicalGuna(me, them);

      return res.status(200).json({
         success: true,
         me: { name: me.name, nakshatra: me.kundli.nakshatra },
         them: {
            name: them.name,
            nakshatra: them.kundli.nakshatra,
            age: them.age,
         },
         compatibility: gunaResult,
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/matching/view/:userId
// Record a profile view (called when user opens a card)
// ─────────────────────────────────────────────────────────
router.post("/view/:userId", async (req, res) => {
   try {
      const theirId = req.params.userId;

      // Use updateOne with $set on a specific sub-document to avoid dupes
      // Check if this viewer already exists, only add if not
      await User.updateOne(
         {
            _id: theirId,
            "profileViews.viewer": { $ne: req.user._id },
         },
         {
            $push: {
               profileViews: { viewer: req.user._id, viewedAt: new Date() },
            },
         },
      );
      await User.findByIdAndUpdate(req.user._id, {
         $addToSet: { viewedProfiles: theirId },
      });
      return res.json({ success: true });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/viewed-me — who viewed my profile
// ─────────────────────────────────────────────────────────
router.get("/viewed-me", async (req, res) => {
   try {
      const me = await User.findById(req.user._id)
         .select("profileViews")
         .populate("profileViews.viewer", "name age photos kundli gender bio");

      // Deduplicate — same viewer can appear multiple times from multiple views
      const seen = new Set();
      const viewers = (me.profileViews ?? [])
         .sort((a, b) => b.viewedAt - a.viewedAt)
         .map((v) => v.viewer)
         .filter((v) => {
            if (!v) return false;
            const id = v._id.toString();
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
         });

      return res.json({ success: true, users: viewers });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/viewed-by-me — profiles I viewed
// ─────────────────────────────────────────────────────────
router.get("/viewed-by-me", async (req, res) => {
   try {
      const me = await User.findById(req.user._id)
         .select("viewedProfiles")
         .populate("viewedProfiles", "name age photos kundli gender bio");

      return res.json({ success: true, users: me.viewedProfiles ?? [] });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/matching/like/:userId
//
// Like a profile. If they already liked me → mutual match!
// SPRINT 3: Checks swipe limit before processing. Increments
// swipe count after a successful like (whether match or not).
// ─────────────────────────────────────────────────────────
router.post("/like/:userId", async (req, res) => {
   try {
      const myId = req.user._id;
      const theirId = req.params.userId;

      if (myId.toString() === theirId) {
         return res
            .status(400)
            .json({ success: false, message: "Cannot like yourself" });
      }

      // ── SPRINT 3: Swipe limit check ───────────────────────────────────────
      const swipeStatus = await checkSwipeLimit(myId);
      if (!swipeStatus.allowed) {
         return res.status(429).json({
            success: false,
            message:
               "You've used all 5 free swipes today. Upgrade to VedicMate Premium for unlimited swipes! ✨",
            swipeLimitReached: true,
            remainingSwipes: 0,
            resetAt: getNextUTCMidnight(),
         });
      }
      // ─────────────────────────────────────────────────────────────────────

      // Fetch both users — need gender for canonical guna direction
      const them = await User.findById(theirId).select(
         "name kundli gender pushToken",
      );
      if (!them) {
         return res
            .status(404)
            .json({ success: false, message: "User not found" });
      }
      // SPRINT 3: Also select swipeTracking + premium for incrementSwipe()
      const me = await User.findById(myId).select(
         "name kundli gender likedUsers pushToken premium swipeTracking",
      );

      // Add to my likedUsers (idempotent)
      if (!me.likedUsers.map(String).includes(theirId)) {
         await User.findByIdAndUpdate(myId, {
            $addToSet: { likedUsers: theirId },
         });
      }

      // Sort IDs for consistent match doc lookup — [smallerId, largerId]
      // This ensures findOne always finds the same doc regardless of who liked first
      const sortedIds = [myId, theirId].map(String).sort();
      let matchDoc = await Match.findOne({ users: { $all: sortedIds } });

      // Calculate CANONICAL guna — female always param 1, male always param 2
      // Both users will see this exact same score
      const gunaResult = getCanonicalGuna(me, them);
      if (!gunaResult) {
         return res
            .status(400)
            .json({ success: false, message: "Kundli data incomplete" });
      }

      // Check if they already liked me (making this a mutual match)
      const isMatch = matchDoc && matchDoc.hasLiked(theirId);

      // ── SPRINT 3: Increment swipe count (runs for both match + no-match) ──
      await me.incrementSwipe();
      const newRemaining = swipeStatus.isPremium
         ? null
         : Math.max(0, swipeStatus.remaining - 1);
      // ─────────────────────────────────────────────────────────────────────

      if (isMatch) {
         // 🎉 Mutual match!
         matchDoc.status = "matched";
         matchDoc.matchedAt = new Date();
         matchDoc.likes.push({ from: myId });
         await matchDoc.save();

         if (!them.pushToken || them.pushToken !== me.pushToken) {
            await sendPushNotification(
               them.pushToken,
               "💫 It's a Cosmic Match!",
               `You and ${me.name} are cosmically compatible! ${gunaResult.totalScore}/36 Gunas ✨`,
               { type: "match", matchId: matchDoc._id },
            );
         }

         return res.status(200).json({
            success: true,
            isMatch: true,
            matchId: matchDoc._id,
            message: "🎉 It's a Cosmic Match!",
            gunaScore: gunaResult.totalScore,
            verdict: gunaResult.verdict,
            // SPRINT 3 additions:
            swipesRemaining: newRemaining,
            isPremium: swipeStatus.isPremium,
         });
      } else {
         // First like — create or update pending match
         if (!matchDoc) {
            // New match doc — store canonical guna score for both users to share
            matchDoc = await Match.create({
               users: sortedIds,
               likes: [{ from: myId }],
               status: "pending",
               gunaScore: gunaResult.totalScore,
               gunaMax: 36,
               gunaPercentage: gunaResult.percentage,
               verdict: gunaResult.verdict,
               verdictEmoji: gunaResult.verdictEmoji,
               breakdown: gunaResult.breakdown,
               doshas: gunaResult.doshas,
            });
         } else {
            // Match doc already exists (they liked me first, I'm now liking back but
            // it somehow didn't trigger isMatch — edge case, just push the like)
            matchDoc.likes.push({ from: myId });
            await matchDoc.save();
         }

         if (!them.pushToken || them.pushToken !== me.pushToken) {
            await sendPushNotification(
               them.pushToken,
               "✨ Someone liked you!",
               `${me.name} wants to connect with you`,
               { type: "liked", userId: myId.toString() },
            );
         }

         return res.status(200).json({
            success: true,
            isMatch: false,
            message: "Like sent! Waiting for them to like you back ⭐",
            // SPRINT 3 additions:
            swipesRemaining: newRemaining,
            isPremium: swipeStatus.isPremium,
         });
      }
   } catch (err) {
      console.error("Like error:", err);
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/matching/pass/:userId
//
// Pass (left swipe).
// SPRINT 3: Checks swipe limit before processing. Increments
// swipe count after pass.
// ─────────────────────────────────────────────────────────
router.post("/pass/:userId", async (req, res) => {
   try {
      const myId = req.user._id;

      // ── SPRINT 3: Swipe limit check ───────────────────────────────────────
      const swipeStatus = await checkSwipeLimit(myId);
      if (!swipeStatus.allowed) {
         return res.status(429).json({
            success: false,
            message:
               "You've used all 5 free swipes today. Upgrade to VedicMate Premium for unlimited swipes! ✨",
            swipeLimitReached: true,
            remainingSwipes: 0,
            resetAt: getNextUTCMidnight(),
         });
      }
      // ─────────────────────────────────────────────────────────────────────

      await User.findByIdAndUpdate(myId, {
         $addToSet: { passedUsers: req.params.userId },
      });

      // ── SPRINT 3: Increment swipe count ──────────────────────────────────
      const me = await User.findById(myId).select("premium swipeTracking");
      await me.incrementSwipe();
      const newRemaining = swipeStatus.isPremium
         ? null
         : Math.max(0, swipeStatus.remaining - 1);
      // ─────────────────────────────────────────────────────────────────────

      return res.status(200).json({
         success: true,
         message: "Passed",
         // SPRINT 3 additions:
         swipesRemaining: newRemaining,
         isPremium: swipeStatus.isPremium,
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/matches
//
// All mutual matches for the Matches tab.
// Populates the OTHER user's profile (not the requester).
// Returns gunaScore from the stored Match doc — this is the
// canonical score that was saved at like time.
// ─────────────────────────────────────────────────────────
router.get("/matches", async (req, res) => {
   try {
      const matches = await Match.find({
         users: req.user._id,
         status: "matched",
      })
         .populate({
            path: "users",
            select: "name photos kundli age bio lastSeen",
            match: { _id: { $ne: req.user._id } },
         })
         .sort({ matchedAt: -1 })
         .lean();

      const formatted = matches.map((m) => {
         const otherUser = m.users.find(
            (u) => u._id.toString() !== req.user._id.toString(),
         );
         return {
            matchId: m._id,
            matchedAt: m.matchedAt,
            user: {
               id: otherUser?._id,
               name: otherUser?.name,
               age: otherUser?.age,
               photo: otherUser?.photos?.[0] || null,
               lastSeen: otherUser?.lastSeen,
               cosmicCard: otherUser?.kundli
                  ? {
                       nakshatra: `${otherUser.kundli.nakshatraSymbol} ${otherUser.kundli.nakshatra}`,
                       gana: otherUser.kundli.gana,
                       animal: otherUser.kundli.animal,
                    }
                  : null,
            },
            compatibility: {
               // Use stored canonical score — same for both users
               gunaScore: m.gunaScore,
               verdict: m.verdict,
               verdictEmoji: m.verdictEmoji,
            },
            lastMessage: m.lastMessage || null,
            unreadCount: m.unreadCount?.[req.user._id.toString()] || 0,
         };
      });

      return res.status(200).json({
         success: true,
         count: formatted.length,
         matches: formatted,
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/matching/unmatch/:matchId
//
// Unmatch / block a matched user.
// Also adds them to passedUsers so they never reappear.
// ─────────────────────────────────────────────────────────
router.delete("/unmatch/:matchId", async (req, res) => {
   try {
      const match = await Match.findOne({
         _id: req.params.matchId,
         users: req.user._id,
      });

      if (!match) {
         return res
            .status(404)
            .json({ success: false, message: "Match not found" });
      }

      match.status = "blocked";
      await match.save();

      // Prevent them from reappearing in discover
      const otherId = match.getOtherUser(req.user._id);
      await User.findByIdAndUpdate(req.user._id, {
         $addToSet: { passedUsers: otherId },
      });

      return res.status(200).json({ success: true, message: "Unmatched" });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/liked-by-me
// People I liked who have NOT yet liked me back
// ─────────────────────────────────────────────────────────
router.get("/liked-by-me", async (req, res) => {
   try {
      const me = await User.findById(req.user._id).select("likedUsers");
      if (!me.likedUsers?.length) return res.json({ success: true, users: [] });

      // Find matched user IDs so we can exclude them
      const myMatches = await Match.find({
         users: req.user._id,
         status: "matched",
      })
         .select("users")
         .lean();

      const matchedUserIds = myMatches
         .flatMap((m) => m.users.map(String))
         .filter((id) => id !== req.user._id.toString());

      // Only show likes where they have NOT liked me back
      // (i.e. not in my likedUsers from their side, and not already matched)
      const users = await User.find({
         _id: {
            $in: me.likedUsers,
            $nin: matchedUserIds,
         },
         onboardingComplete: true,
         // Exclude users who already liked me back (those are matches)
         likedUsers: { $ne: req.user._id },
      }).select("name age bio photos kundli gender");

      return res.json({ success: true, users });
   } catch (err) {
      console.error("[MATCHING] liked-by-me error:", err);
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/matching/liked-me
// People who liked me but I have NOT liked back yet
// ─────────────────────────────────────────────────────────
router.get("/liked-me", async (req, res) => {
   try {
      // Find my own likedUsers to exclude people I already liked back
      const me = await User.findById(req.user._id).select("likedUsers");

      const myLikedIds = (me.likedUsers ?? []).map(String);

      // Find matched user IDs so we can exclude them
      const myMatches = await Match.find({
         users: req.user._id,
         status: "matched",
      })
         .select("users")
         .lean();

      const matchedUserIds = myMatches
         .flatMap((m) => m.users.map(String))
         .filter((id) => id !== req.user._id.toString());

      const users = await User.find({
         likedUsers: req.user._id, // they liked me
         onboardingComplete: true,
         _id: {
            $ne: req.user._id,
            $nin: [...myLikedIds, ...matchedUserIds],
         },
      }).select("name age bio photos kundli gender");

      return res.json({ success: true, users });
   } catch (err) {
      console.error("[MATCHING] liked-me error:", err);
      return res.status(500).json({ success: false, message: err.message });
   }
});

module.exports = router;
