// src/routes/debug.js
// ─────────────────────────────────────────────────────────────────────────────
// DEBUG ROUTES — only active when NODE_ENV !== 'production'
// Lets you test the discover filter logic via curl/Postman without the app
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
// GET /api/debug/users
// List all onboarded users with their key filter fields at a glance
//
// Usage: curl http://192.168.29.18:5000/api/debug/users
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
// Run the discover filter as if this user opened the app
// Shows exactly who they'd see and WHY others were excluded
//
// Usage: curl http://192.168.29.18:5000/api/debug/discover/brat1@b.com
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

   // All other onboarded users
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

      // Already liked/passed?
      if (excludeIds.map(String).includes(String(u._id))) {
         reasons.push("already liked/passed by me");
      }
      // Age filter
      if (u.age < minAge || u.age > maxAge) {
         reasons.push(`age ${u.age} outside my range ${minAge}-${maxAge}`);
      }
      // My genderPref filter
      if (genderPref !== "both" && u.gender !== genderPref) {
         reasons.push(`I want ${genderPref}, they are ${u.gender}`);
      }
      // Their genderPref — do they want to see me?
      const theirPref = u.preferences?.genderPref;
      if (theirPref && theirPref !== "both" && theirPref !== me.gender) {
         reasons.push(`they want ${theirPref}, I am ${me.gender}`);
      }

      let gunaScore = null;
      let gunaPass = true;
      if (reasons.length === 0) {
         // Calculate guna
         const myN = getNakshatraObj(me.kundli);
         const theirN = getNakshatraObj(u.kundli);
         if (myN && theirN) {
            const result = calculateGunaMilan(myN, theirN);
            gunaScore = result.totalScore;
            if (gunaScore < minGunaScore) {
               reasons.push(`guna ${gunaScore}/36 < my min ${minGunaScore}`);
               gunaPass = false;
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
// Check guna score between two users
//
// Usage: curl http://192.168.29.18:5000/api/debug/guna/brat1@b.com/brat4@b.com
// ─────────────────────────────────────────────────────────────────────────────
router.get("/guna/:email1/:email2", async (req, res) => {
   const [u1, u2] = await Promise.all([
      User.findOne({ email: req.params.email1.toLowerCase() }).lean(),
      User.findOne({ email: req.params.email2.toLowerCase() }).lean(),
   ]);
   if (!u1 || !u2)
      return res.status(404).json({ error: "One or both users not found" });

   const n1 = getNakshatraObj(u1.kundli);
   const n2 = getNakshatraObj(u2.kundli);
   if (!n1 || !n2)
      return res.status(400).json({ error: "Missing kundli data" });

   const result = calculateGunaMilan(n1, n2);
   console.log(
      `\n[DEBUG/GUNA] ${u1.name} (${u1.kundli?.nakshatra}) × ${u2.name} (${u2.kundli?.nakshatra}) = ${result.totalScore}/36`,
   );

   return res.json({
      user1: {
         name: u1.name,
         nakshatra: u1.kundli?.nakshatra,
         gana: u1.kundli?.gana,
         nadi: u1.kundli?.nadi,
      },
      user2: {
         name: u2.name,
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
// (useful for retesting without deleting accounts)
//
// Usage: curl -X DELETE http://192.168.29.18:5000/api/debug/reset/brat1@b.com
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
