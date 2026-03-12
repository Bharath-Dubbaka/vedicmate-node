/**
 * src/routes/matching.js
 *
 * CANONICAL GUNA MILAN DIRECTION:
 * ─────────────────────────────────────────────────────────
 * Traditional Vedic Ashta Koota always calculates as:
 *   calculateGunaMilan(BRIDE/female, GROOM/male)
 *
 * Why it matters:
 *   - Varna: male's rank must be >= female's rank (positional rule)
 *   - Tara:  counted FROM bride's nakshatra TO groom's (directional)
 *   - Bhakoot: rashi position is counted bride→groom (directional)
 *
 * Enforced by the helper: getCanonicalGuna(userA, userB)
 *   → always resolves who is bride/groom regardless of who is "me"
 *   → both users see the SAME score
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
      brideNak = nakB; // swap — female always goes first
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
// GET /api/matching/discover
//
// Returns a batch of compatible profiles for the swipe deck.
// Filters by: age range, gender preference, mutual gender pref,
//             and minimum guna score threshold.
//
// Query params:
//   limit  - profiles to return (default 10)
//   cursor - last seen userId for pagination
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
      const { minAge, maxAge, minGunaScore, genderPref } = me.preferences;

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

      // My preference: only show the gender I want to see
      if (genderPref !== "both") {
         query.gender = genderPref;
      }

      // Mutual filter: only show people who would also want to see me
      // e.g. if I'm male, only show females whose genderPref is "male" or "both"
      if (me.gender && me.gender !== "other") {
         query["preferences.genderPref"] = { $in: [me.gender, "both"] };
      }

      // Fetch 3x more than needed — we'll filter by guna score after calculation
      const candidates = await User.find(query)
         .select("name age gender kundli photos bio lookingFor")
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

         results.push({
            user: {
               id: candidate._id,
               name: candidate.name,
               age: candidate.age,
               bio: candidate.bio,
               photos: candidate.photos || [],
               lookingFor: candidate.lookingFor,
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
               breakdown: gunaResult.breakdown, // full 8-koota object for modal
               doshas: gunaResult.doshas, // dosha array for modal
               hasDoshas: gunaResult.doshas.length > 0,
               doshaCount: gunaResult.doshas.length,
            },
         });

         if (results.length >= parseInt(limit)) break;
      }

      // Sort best matches first
      results.sort(
         (a, b) => b.compatibility.totalScore - a.compatibility.totalScore,
      );

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
// GET /api/matching/compatibility/:userId
//
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
         compatibility: gunaResult, // full breakdown
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/matching/like/:userId
//
// Like a profile. If they already liked me → mutual match!
//
// Flow:
//   1. Add theirId to my likedUsers array
//   2. Look for an existing Match doc for this pair
//   3a. If match doc exists AND they already liked me → set status=matched
//   3b. Otherwise → create/update pending Match doc
//
// The Match doc stores the CANONICAL guna score so both users
// always see the same number in their Matches tab.
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

      // Fetch both users — need gender for canonical guna direction
      const them = await User.findById(theirId).select(
         "name kundli gender pushToken",
      );
      if (!them) {
         return res
            .status(404)
            .json({ success: false, message: "User not found" });
      }
      const me = await User.findById(myId).select(
         "name kundli gender likedUsers",
      );

      // Add to my likedUsers (idempotent — $addToSet ignores duplicates)
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

      if (isMatch) {
         // ── 🎉 Mutual match! ──────────────────────────
         matchDoc.status = "matched";
         matchDoc.matchedAt = new Date();
         matchDoc.likes.push({ from: myId });
         await matchDoc.save();

         // Notify them via Expo push
         await sendPushNotification(
            them.pushToken,
            "💫 It's a Cosmic Match!",
            `You and ${me.name} are cosmically compatible! ${gunaResult.totalScore}/36 Gunas ✨`,
            { type: "match", matchId: matchDoc._id },
         );

         return res.status(200).json({
            success: true,
            isMatch: true,
            matchId: matchDoc._id,
            message: "🎉 It's a Cosmic Match!",
            gunaScore: gunaResult.totalScore,
            verdict: gunaResult.verdict,
         });
      } else {
         // ── First like — create or update pending match ──
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

         return res.status(200).json({
            success: true,
            isMatch: false,
            message: "Like sent! Waiting for them to like you back ⭐",
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
// Pass (left swipe) — add to passedUsers so they never
// appear in discover again for this user
// ─────────────────────────────────────────────────────────
router.post("/pass/:userId", async (req, res) => {
   try {
      await User.findByIdAndUpdate(req.user._id, {
         $addToSet: { passedUsers: req.params.userId },
      });
      return res.status(200).json({ success: true, message: "Passed" });
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
            match: { _id: { $ne: req.user._id } }, // only populate the OTHER user
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
// Helper: top 3 highest-scoring kootas for card highlights
//
// Sorts by percentage (score/max) so kootas are comparable
// across their different max values (Nadi=8, Varna=1, etc.)
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

module.exports = router;
