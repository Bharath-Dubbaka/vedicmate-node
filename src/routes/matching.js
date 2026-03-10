// src/routes/matching.js
const express = require("express");
const User = require("../models/User");
const Match = require("../models/Match");
const { protect } = require("../middleware/auth");
const { calculateGunaMilan } = require("../engines/gunaMilan");
const { NAKSHATRAS } = require("../engines/nakshatraLookup");

const router = express.Router();
router.use(protect);

// ─────────────────────────────────────────────────────────
// Helper: get full Nakshatra object from kundli stored in DB
// ─────────────────────────────────────────────────────────
const getNakshatraObj = (kundli) => {
   if (!kundli) return null;
   // Re-hydrate from index for full attribute access
   return NAKSHATRAS[kundli.nakshatraIndex];
};

// ─────────────────────────────────────────────────────────
// Helper: send Expo push notification
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
// Returns a batch of compatible profiles for the swipe deck
//
// Query params:
//   limit  - number of profiles to return (default 10)
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
      const excludeIds = [req.user._id, ...me.likedUsers, ...me.passedUsers];

      const query = {
         _id: { $nin: excludeIds, ...(cursor && { $gt: cursor }) },
         onboardingComplete: true,
         isActive: true,
         kundli: { $exists: true },
         age: { $gte: minAge, $lte: maxAge },
      };

      // Gender filter
      if (genderPref !== "both") {
         query.gender = genderPref;
      }
      // Exclude my own gender from seeing same gender (if they prefer opposite)
      if (me.gender === "male") {
         query["preferences.genderPref"] = { $in: ["male", "both"] };
      } else if (me.gender === "female") {
         query["preferences.genderPref"] = { $in: ["female", "both"] };
      }

      // Fetch more than needed so we can filter by guna score
      const candidates = await User.find(query)
         .select("name age gender kundli photos bio lookingFor")
         .limit(parseInt(limit) * 3) // fetch 3x, filter down after guna check
         .lean();

      // ── Calculate Guna for each candidate ─────────
      const myNakshatra = getNakshatraObj(me.kundli);
      const results = [];

      for (const candidate of candidates) {
         const theirNakshatra = getNakshatraObj(candidate.kundli);
         if (!theirNakshatra || !myNakshatra) continue;

         const gunaResult = calculateGunaMilan(myNakshatra, theirNakshatra);

         // Filter out below minimum guna score
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
                  animal: candidate.kundli.animal,
                  gana: candidate.kundli.gana,
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
               // Send top 3 highlights only (save bandwidth)
               highlights: getTopHighlights(gunaResult.breakdown),
               hasDoshas: gunaResult.doshas.length > 0,
               doshaCount: gunaResult.doshas.length,
            },
         });

         if (results.length >= parseInt(limit)) break;
      }

      // Sort by guna score descending
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
// Full Guna Milan report between me and any user
// Called when user taps "View Full Kundli" on a profile
// ─────────────────────────────────────────────────────────
router.get("/compatibility/:userId", async (req, res) => {
   try {
      const me = await User.findById(req.user._id).select("kundli name");
      const them = await User.findById(req.params.userId).select(
         "kundli name age gender photos bio",
      );

      if (!them) {
         return res
            .status(404)
            .json({ success: false, message: "User not found" });
      }
      if (!me.kundli || !them.kundli) {
         return res
            .status(400)
            .json({
               success: false,
               message: "One or both users have incomplete Kundli",
            });
      }

      const myNakshatra = getNakshatraObj(me.kundli);
      const theirNakshatra = getNakshatraObj(them.kundli);
      const gunaResult = calculateGunaMilan(myNakshatra, theirNakshatra);

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
// Like a profile. If they already liked me → it's a match!
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

      const them = await User.findById(theirId).select("name kundli pushToken");
      if (!them) {
         return res
            .status(404)
            .json({ success: false, message: "User not found" });
      }

      const me = await User.findById(myId).select("name kundli likedUsers");

      // Add to likedUsers (prevent duplicates)
      if (!me.likedUsers.includes(theirId)) {
         await User.findByIdAndUpdate(myId, {
            $addToSet: { likedUsers: theirId },
         });
      }

      // ── Check if they already liked me ───────────
      // Find existing pending match where they liked me
      const sortedIds = [myId, theirId].sort();
      let matchDoc = await Match.findOne({ users: { $all: sortedIds } });

      // Calculate guna score (needed either way)
      const myNakshatra = getNakshatraObj(me.kundli);
      const theirNakshatra = getNakshatraObj(them.kundli);
      const gunaResult = calculateGunaMilan(myNakshatra, theirNakshatra);

      const isMatch = matchDoc && matchDoc.hasLiked(theirId);

      if (isMatch) {
         // 🎉 Mutual match!
         matchDoc.status = "matched";
         matchDoc.matchedAt = new Date();
         matchDoc.likes.push({ from: myId });
         await matchDoc.save();

         // Notify them
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
         // First like — create or update pending match
         if (!matchDoc) {
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
// Pass (left swipe) on a profile
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
// Get all mutual matches (for the Matches tab)
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
// Unmatch / block
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

      // Also add to passedUsers so they never appear in discover again
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
// Helper: return top 3 highest-scoring kootas as highlights
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
