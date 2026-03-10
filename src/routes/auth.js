// src/routes/auth.js
const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─────────────────────────────────────────────────────────
// Helper: sign a JWT for our app
// ─────────────────────────────────────────────────────────
const signToken = (userId) =>
   jwt.sign({ id: userId }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "30d",
   });

// ─────────────────────────────────────────────────────────
// POST /api/auth/google
// Body: { idToken: "<google id token from expo>" }
//
// Flow:
//   1. Verify Google ID token
//   2. Find or create User in DB
//   3. Return our JWT + user profile
// ─────────────────────────────────────────────────────────
router.post("/google", async (req, res) => {
   try {
      const { idToken } = req.body;

      if (!idToken) {
         return res
            .status(400)
            .json({ success: false, message: "idToken is required" });
      }

      // 1. Verify with Google
      const ticket = await googleClient.verifyIdToken({
         idToken,
         audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      const { sub: googleId, email, name, picture } = payload;

      if (!email) {
         return res
            .status(400)
            .json({ success: false, message: "Google account has no email" });
      }

      // 2. Find or create user
      let user = await User.findOne({ $or: [{ googleId }, { email }] });
      const isNewUser = !user;

      if (isNewUser) {
         user = await User.create({
            googleId,
            email,
            name,
            avatar: picture,
            onboardingComplete: false,
         });
      } else {
         // Update Google fields in case they changed
         user.googleId = googleId;
         user.avatar = picture || user.avatar;
         user.name = name || user.name;
         await user.save({ validateBeforeSave: false });
      }

      // 3. Return JWT + status
      const token = signToken(user._id);

      return res.status(200).json({
         success: true,
         token,
         isNewUser,
         onboardingComplete: user.onboardingComplete,
         user: {
            id: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            onboardingComplete: user.onboardingComplete,
         },
      });
   } catch (err) {
      console.error("Google auth error:", err.message);
      if (err.message?.includes("Token used too late")) {
         return res
            .status(401)
            .json({ success: false, message: "Google token expired" });
      }
      return res
         .status(500)
         .json({ success: false, message: "Authentication failed" });
   }
});

// ─────────────────────────────────────────────────────────
// GET /api/auth/me
// Returns current user's full profile (protected)
// ─────────────────────────────────────────────────────────
router.get("/me", protect, async (req, res) => {
   try {
      const user = await User.findById(req.user._id).select(
         "-likedUsers -passedUsers -pushToken",
      );
      return res.status(200).json({ success: true, user });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Body: { token } → returns new token if valid
// ─────────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
   try {
      const { token } = req.body;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const newToken = signToken(decoded.id);
      return res.status(200).json({ success: true, token: newToken });
   } catch {
      return res.status(401).json({ success: false, message: "Invalid token" });
   }
});

// ─────────────────────────────────────────────────────────
// PATCH /api/auth/push-token
// Save Expo push notification token
// ─────────────────────────────────────────────────────────
router.patch("/push-token", protect, async (req, res) => {
   try {
      const { pushToken } = req.body;
      await User.findByIdAndUpdate(req.user._id, { pushToken });
      return res
         .status(200)
         .json({ success: true, message: "Push token saved" });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

module.exports = router;
