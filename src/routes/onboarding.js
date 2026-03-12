// src/routes/onboarding.js
const express = require("express");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { getNakshatraFromBirth } = require("../engines/moonPosition");

const router = express.Router();

// All onboarding routes require auth
router.use(protect);

// ─────────────────────────────────────────────────────────
// POST /api/onboarding/birth-details
//
// Step 1 of onboarding — save birth details & compute Kundli
//
// Body:
// {
//   dateOfBirth: "1995-08-15",
//   timeOfBirth: "10:30",
//   placeOfBirth: "Mumbai, India",
//   latitude: 19.0760,
//   longitude: 72.8777,
//   utcOffset: 5.5
// }
// ─────────────────────────────────────────────────────────
router.post("/birth-details", async (req, res) => {
   try {
      const {
         dateOfBirth,
         timeOfBirth,
         placeOfBirth,
         latitude,
         longitude,
         utcOffset = 5.5,
      } = req.body;

      // Validate required fields
      if (
         !dateOfBirth ||
         !timeOfBirth ||
         !placeOfBirth ||
         latitude == null ||
         longitude == null
      ) {
         return res.status(400).json({
            success: false,
            message:
               "dateOfBirth, timeOfBirth, placeOfBirth, latitude, longitude are required",
         });
      }

      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const timeRegex = /^\d{2}:\d{2}$/;
      if (!dateRegex.test(dateOfBirth) || !timeRegex.test(timeOfBirth)) {
         return res.status(400).json({
            success: false,
            message:
               "dateOfBirth must be YYYY-MM-DD and timeOfBirth must be HH:MM",
         });
      }

      // Age check (18+)
      const birthYear = parseInt(dateOfBirth.split("-")[0]);
      const currentYear = new Date().getFullYear();
      if (currentYear - birthYear < 18) {
         return res.status(400).json({
            success: false,
            message: "You must be at least 18 years old",
         });
      }

      // ── Calculate Kundli ──────────────────────────
      const astroResult = getNakshatraFromBirth({
         dateOfBirth,
         timeOfBirth,
         utcOffset,
      });

      const { nakshatra, rashi, rashiIndex, pada, moonLongitude } = astroResult;

      const kundli = {
         nakshatra: nakshatra.name,
         nakshatraIndex: nakshatra.index,
         nakshatraSymbol: nakshatra.symbol,
         rashi,
         rashiIndex,
         pada,
         animal: nakshatra.animal,
         gana: nakshatra.gana,
         varna: nakshatra.varna,
         nadi: nakshatra.nadi,
         vashya: nakshatra.vashya,
         lordPlanet: nakshatra.lord,
         lordIndex: nakshatra.lordIndex,
         moonLongitude,
      };

      // ── Save to DB ────────────────────────────────
      const birthDetails = {
         dateOfBirth,
         timeOfBirth,
         placeOfBirth,
         latitude,
         longitude,
         utcOffset,
      };

      // Derive age
      const age = currentYear - birthYear;

      await User.findByIdAndUpdate(req.user._id, {
         birthDetails,
         kundli,
         age,
      });

      return res.status(200).json({
         success: true,
         message: "Birth details saved and Kundli calculated",
         kundli,
         cosmicProfile: {
            nakshatra: `${nakshatra.symbol} ${nakshatra.name}`,
            rashi,
            pada,
            animal: nakshatra.animal,
            gana: nakshatra.gana,
            ganaTitle:
               nakshatra.gana === "Deva"
                  ? "Divine Soul ✨"
                  : nakshatra.gana === "Manushya"
                    ? "Human Heart 🤝"
                    : "Fierce Spirit 🔥",
            nadi: nakshatra.nadi,
            personality: getPersonalityBlurb(nakshatra),
         },
      });
   } catch (err) {
      console.error("Birth details error:", err);
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/onboarding/profile
//
// Step 2 — save personal profile details
//
// Body:
// {
//   gender: "female",
//   bio: "Looking for a soulmate...",
//   lookingFor: "marriage",
//   preferences: { minAge: 25, maxAge: 35, minGunaScore: 24, genderPref: "male" }
// }
// ─────────────────────────────────────────────────────────
router.post("/profile", async (req, res) => {
   try {
      const { gender, bio, lookingFor, preferences } = req.body;

      if (!gender) {
         return res
            .status(400)
            .json({ success: false, message: "gender is required" });
      }

      const updates = {
         gender,
         ...(bio && { bio: bio.slice(0, 300) }),
         ...(lookingFor && { lookingFor }),
         ...(preferences && {
            preferences: {
               minAge: preferences.minAge || 18,
               maxAge: preferences.maxAge || 45,
               minGunaScore: preferences.minGunaScore ?? 18,
               genderPref: preferences.genderPref || "both",
            },
         }),
      };

      await User.findByIdAndUpdate(req.user._id, updates);

      return res.status(200).json({
         success: true,
         message: "Profile saved",
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/onboarding/complete
//
// Step 3 — mark onboarding as done
// Call this after photos are uploaded
// ─────────────────────────────────────────────────────────
router.post("/complete", async (req, res) => {
   try {
      const user = await User.findById(req.user._id);

      // Check all required fields are filled
      if (!user.kundli || !user.birthDetails || !user.gender) {
         return res.status(400).json({
            success: false,
            message:
               "Complete birth details and profile before finishing onboarding",
            missing: {
               birthDetails: !user.birthDetails,
               kundli: !user.kundli,
               gender: !user.gender,
            },
         });
      }

      user.onboardingComplete = true;
      await user.save();

      return res.status(200).json({
         success: true,
         message: "🎉 Welcome to Cosmic Match! Your cosmic journey begins.",
         user: {
            id: user._id,
            name: user.name,
            kundli: user.kundli,
            onboardingComplete: true,
         },
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/onboarding/cosmic-profile
//
// Returns a display-ready cosmic profile card
// (used on the Cosmic Profile reveal screen in Expo)
// ─────────────────────────────────────────────────────────
router.get("/cosmic-profile", async (req, res) => {
   try {
      const user = await User.findById(req.user._id).select(
         "name kundli birthDetails",
      );

      if (!user.kundli) {
         return res.status(404).json({
            success: false,
            message: "Kundli not yet calculated. Complete birth details first.",
         });
      }

      const { kundli } = user;

      return res.status(200).json({
         success: true,
         cosmicProfile: {
            name: user.name,
            nakshatra: `${kundli.nakshatraSymbol} ${kundli.nakshatra}`,
            rashi: kundli.rashi,
            pada: kundli.pada,
            animal: kundli.animal,
            gana: kundli.gana,
            ganaTitle:
               kundli.gana === "Deva"
                  ? "Divine Soul ✨"
                  : kundli.gana === "Manushya"
                    ? "Human Heart 🤝"
                    : "Fierce Spirit 🔥",
            nadi: kundli.nadi,
            varna: kundli.varna,
            lordPlanet: kundli.lordPlanet,
            personality: getPersonalityBlurbFromKundli(kundli),
         },
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
const getPersonalityBlurb = (nakshatra) => {
   const blurbs = {
      Deva: {
         Vata: "Bright, imaginative, and spiritually driven. You seek harmony and depth in relationships.",
         Pitta: "Passionate and purposeful. You bring warmth and wisdom to everyone around you.",
         Kapha: "Nurturing and compassionate. You create a sense of calm and stability wherever you go.",
      },
      Manushya: {
         Vata: "Curious and adaptable. You bring an open mind and a playful spirit to your connections.",
         Pitta: "Ambitious and loyal. You love deeply and give everything to the people you care about.",
         Kapha: "Grounded and reliable. Your steadiness and warmth make you a natural partner.",
      },
      Rakshasa: {
         Vata: "Intense and independent. You are magnetic and unconventional — one of a kind.",
         Pitta: "Fierce and passionate. You challenge the people around you to grow and evolve.",
         Kapha: "Powerful and protective. Once you commit, your loyalty runs deeper than the ocean.",
      },
   };
   return (
      blurbs[nakshatra.gana]?.[nakshatra.nadi] ||
      "A unique cosmic soul on a remarkable journey."
   );
};

const getPersonalityBlurbFromKundli = (kundli) =>
   getPersonalityBlurb({ gana: kundli.gana, nadi: kundli.nadi });

module.exports = router;
