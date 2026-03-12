// src/routes/debug.js
// ─────────────────────────────────────────────────────────────────────────────
// DEBUG ROUTES — only active when NODE_ENV !== 'production'
//
// Mount in src/app.js:
//   if (process.env.NODE_ENV !== "production") {
//     app.use("/api/debug", require("./routes/debug"));
//   }
// ─────────────────────────────────────────────────────────────────────────────

const express = require("express");
const User = require("../models/User");
const Match = require("../models/Match");
const { calculateGunaMilan } = require("../engines/gunaMilan");
const { NAKSHATRAS } = require("../engines/nakshatraLookup");

const router = express.Router();

const getNakshatraObj = (kundli) =>
   kundli ? NAKSHATRAS[kundli.nakshatraIndex] : null;

// ─────────────────────────────────────────────────────────────────────────────
// Canonical guna helper — mirrors the one in matching.js
//
// ALWAYS calls calculateGunaMilan(femaleNak, maleNak) regardless of
// which email was passed first. This makes debug output consistent
// with what the app shows both users.
//
// Same-gender fallback: uses u1→u2 order (consistent, if non-traditional)
// ─────────────────────────────────────────────────────────────────────────────
const getCanonicalGuna = (u1, u2) => {
   const n1 = getNakshatraObj(u1.kundli);
   const n2 = getNakshatraObj(u2.kundli);
   if (!n1 || !n2) return null;

   if (u1.gender === "female" && u2.gender === "male") {
      return calculateGunaMilan(n1, n2); // u1=bride, u2=groom ✓
   } else if (u1.gender === "male" && u2.gender === "female") {
      return calculateGunaMilan(n2, n1); // swap — female always param 1
   } else {
      return calculateGunaMilan(n1, n2); // same-gender fallback
   }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/debug/users
// List all onboarded users with key filter fields at a glance
//
// Usage: curl http://192.168.29.18:5000/api/debug/users -UseBasicParsing
// ─────────────────────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
   const users = await User.find({ onboardingComplete: true })
      .select(
         "name email gender age lookingFor preferences kundli likedUsers passedUsers",
      )
      .lean();

   const table = users.map((u) => ({
      name: u.name,
      email: u.email,
      gender: u.gender,
      age: u.age,
      lookingFor: u.lookingFor,
      nakshatra: u.kundli?.nakshatra,
      gana: u.kundli?.gana,
      nadi: u.kundli?.nadi,
      genderPref: u.preferences?.genderPref,
      ageRange: `${u.preferences?.minAge}-${u.preferences?.maxAge}`,
      minGuna: u.preferences?.minGunaScore,
      likedCount: u.likedUsers?.length,
      passedCount: u.passedUsers?.length,
      _id: u._id,
   }));

   console.log("\n[DEBUG/USERS] ─────────────────────────────────");
   console.table(table.map((u) => ({ ...u, _id: undefined })));
   console.log("─────────────────────────────────────────────\n");

   return res.json({ count: table.length, users: table });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/debug/discover/:email
// Simulate the discover feed for a user — shows who appears and why others
// are excluded (age, gender pref, guna score, already liked/passed)
//
// Usage: curl http://192.168.29.18:5000/api/debug/discover/m1@b.com -UseBasicParsing
// ─────────────────────────────────────────────────────────────────────────────
router.get("/discover/:email", async (req, res) => {
   const me = await User.findOne({
      email: req.params.email.toLowerCase(),
   }).lean();
   if (!me) return res.status(404).json({ error: "User not found" });
   if (!me.kundli) return res.status(400).json({ error: "User has no kundli" });

   const { minAge, maxAge, minGunaScore, genderPref } = me.preferences || {};
   const excludeIds = [
      me._id,
      ...(me.likedUsers || []),
      ...(me.passedUsers || []),
   ];

   const everyone = await User.find({
      _id: { $ne: me._id },
      onboardingComplete: true,
      isActive: true,
      kundli: { $exists: true },
   })
      .select("name email gender age kundli preferences lookingFor likedUsers")
      .lean();

   const results = [];
   const excluded = [];

   for (const u of everyone) {
      const reasons = [];

      if (excludeIds.map(String).includes(String(u._id))) {
         reasons.push("already liked/passed by me");
      }
      if (u.age < minAge || u.age > maxAge) {
         reasons.push(`age ${u.age} outside my range ${minAge}-${maxAge}`);
      }
      if (genderPref !== "both" && u.gender !== genderPref) {
         reasons.push(`I want ${genderPref}, they are ${u.gender}`);
      }
      const theirPref = u.preferences?.genderPref;
      if (theirPref && theirPref !== "both" && theirPref !== me.gender) {
         reasons.push(`they want ${theirPref}, I am ${me.gender}`);
      }

      let gunaScore = null;
      if (reasons.length === 0) {
         // Use canonical direction — same score the app would show
         const result = getCanonicalGuna(me, u);
         if (result) {
            gunaScore = result.totalScore;
            if (gunaScore < minGunaScore) {
               reasons.push(`guna ${gunaScore}/36 < my min ${minGunaScore}`);
            }
         }
      }

      const entry = {
         name: u.name,
         email: u.email,
         gender: u.gender,
         age: u.age,
         nakshatra: u.kundli?.nakshatra,
         gana: u.kundli?.gana,
         theirGenderPref: u.preferences?.genderPref,
         gunaScore,
      };

      if (reasons.length === 0) {
         results.push({ ...entry, status: "✅ SHOWN" });
      } else {
         excluded.push({ ...entry, status: "❌ EXCLUDED", reasons });
      }
   }

   console.log(
      `\n[DEBUG/DISCOVER] as ${me.email} (${me.gender}, wants: ${genderPref}, age: ${minAge}-${maxAge}, minGuna: ${minGunaScore})`,
   );
   console.log("SHOWN:");
   console.table(
      results.map((r) => ({
         name: r.name,
         gender: r.gender,
         age: r.age,
         nakshatra: r.nakshatra,
         guna: r.gunaScore,
      })),
   );
   console.log("EXCLUDED:");
   console.table(
      excluded.map((r) => ({ name: r.name, reasons: r.reasons.join(" | ") })),
   );
   console.log("─────────────────────────────────────────────\n");

   return res.json({
      viewer: {
         email: me.email,
         gender: me.gender,
         genderPref,
         ageRange: `${minAge}-${maxAge}`,
         minGuna: minGunaScore,
         nakshatra: me.kundli?.nakshatra,
      },
      shown: results,
      excluded: excluded,
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/debug/guna/:email1/:email2
// Check the CANONICAL guna score between two users.
// Order of emails doesn't matter — female is always treated as bride.
// Score matches exactly what both users see in the app.
//
// Usage: curl http://192.168.29.18:5000/api/debug/guna/m11@b.com/f11@b.com -UseBasicParsing
//        curl http://192.168.29.18:5000/api/debug/guna/f11@b.com/m11@b.com -UseBasicParsing
//        → both return the same score now ✓
// ─────────────────────────────────────────────────────────────────────────────
router.get("/guna/:email1/:email2", async (req, res) => {
   const [u1, u2] = await Promise.all([
      User.findOne({ email: req.params.email1.toLowerCase() }).lean(),
      User.findOne({ email: req.params.email2.toLowerCase() }).lean(),
   ]);
   if (!u1 || !u2)
      return res.status(404).json({ error: "One or both users not found" });

   const result = getCanonicalGuna(u1, u2);
   if (!result) return res.status(400).json({ error: "Missing kundli data" });

   // Tell the caller which direction was used so it's transparent
   const bride = u1.gender === "female" ? u1 : u2;
   const groom = u1.gender === "male" ? u1 : u2;
   const sameGender = u1.gender === u2.gender;

   console.log(
      `\n[DEBUG/GUNA] ${bride.name} (bride/female) × ${groom.name} (groom/male) = ${result.totalScore}/36`,
      sameGender ? "(same-gender fallback order)" : "(canonical ✓)",
   );

   return res.json({
      canonical: !sameGender,
      direction: sameGender
         ? `same-gender fallback: ${u1.name} → ${u2.name}`
         : `bride: ${bride.name} (${bride.kundli?.nakshatra}) → groom: ${groom.name} (${groom.kundli?.nakshatra})`,
      user1: {
         name: u1.name,
         gender: u1.gender,
         nakshatra: u1.kundli?.nakshatra,
         gana: u1.kundli?.gana,
         nadi: u1.kundli?.nadi,
      },
      user2: {
         name: u2.name,
         gender: u2.gender,
         nakshatra: u2.kundli?.nakshatra,
         gana: u2.kundli?.gana,
         nadi: u2.kundli?.nadi,
      },
      score: `${result.totalScore}/36 (${result.percentage}%)`,
      verdict: `${result.verdictEmoji} ${result.verdict}`,
      breakdown: result.breakdown,
      doshas: result.doshas,
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/debug/matches
// List all match documents with user names resolved
//
// Usage: curl http://192.168.29.18:5000/api/debug/matches -UseBasicParsing
// ─────────────────────────────────────────────────────────────────────────────
router.get("/matches", async (req, res) => {
   const matches = await Match.find()
      .populate("users", "name email gender kundli")
      .lean();
   const table = matches.map((m) => ({
      users: m.users.map((u) => u.name).join(" ↔ "),
      status: m.status,
      gunaScore: `${m.gunaScore}/36`,
      verdict: m.verdict,
      likes: m.likes?.length,
      createdAt: m.createdAt,
   }));
   console.log("\n[DEBUG/MATCHES]");
   console.table(table);
   return res.json({ count: matches.length, matches: table });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/debug/reset/:email
// Clear a user's liked/passed history so they see everyone again in discover
//
// Usage: curl -Method DELETE http://192.168.29.18:5000/api/debug/reset/m1@b.com -UseBasicParsing
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/reset/:email", async (req, res) => {
   const user = await User.findOneAndUpdate(
      { email: req.params.email.toLowerCase() },
      { $set: { likedUsers: [], passedUsers: [] } },
      { new: true },
   ).select("name email");

   if (!user) return res.status(404).json({ error: "User not found" });

   console.log(`[DEBUG/RESET] Cleared liked/passed for ${user.email}`);
   return res.json({
      success: true,
      message: `Cleared swipe history for ${user.name}`,
   });
});

module.exports = router;
