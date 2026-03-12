// src/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();

// ── Helper: sign a JWT ───────────────────────────────────────────────────────
const signToken = (userId) => {
   console.log(`[AUTH] Signing JWT for userId: ${userId}`);
   return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "30d",
   });
};

// ── Helper: format user for client response ──────────────────────────────────
const formatUser = (user) => ({
   id: user._id,
   name: user.name,
   email: user.email,
   avatar: user.avatar || null,
   onboardingComplete: user.onboardingComplete,
   kundli: user.kundli || null,
   preferences: user.preferences || null,
   gender: user.gender || null,
   bio: user.bio || null,
   lookingFor: user.lookingFor || null,
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// Body: { name, email, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
   try {
      const { name, email, password } = req.body;

      console.log(`[AUTH/REGISTER] Attempt for email: ${email}`);

      if (!name || !email || !password) {
         return res.status(400).json({
            success: false,
            message: "Name, email, and password are required",
         });
      }

      if (password.length < 6) {
         return res.status(400).json({
            success: false,
            message: "Password must be at least 6 characters",
         });
      }

      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
         return res.status(409).json({
            success: false,
            message: "An account with this email already exists",
         });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      console.log(`[AUTH/REGISTER] Password hashed for: ${email}`);

      const user = await User.create({
         name: name.trim(),
         email: email.toLowerCase().trim(),
         passwordHash, // ← stored as passwordHash in DB
         onboardingComplete: false,
      });

      console.log(`[AUTH/REGISTER] User created: ${user._id} (${email})`);

      const token = signToken(user._id);

      return res.status(201).json({
         success: true,
         token,
         user: formatUser(user),
      });
   } catch (err) {
      console.error("[AUTH/REGISTER] Error:", err.message);
      return res.status(500).json({
         success: false,
         message: "Registration failed. Please try again.",
      });
   }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Body: { email, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
   try {
      const { email, password } = req.body;

      console.log(`[AUTH/LOGIN] Attempt for email: ${email}`);

      if (!email || !password) {
         return res.status(400).json({
            success: false,
            message: "Email and password are required",
         });
      }

      // Must use .select("+passwordHash") because field has select:false in schema
      const user = await User.findOne({ email: email.toLowerCase() }).select(
         "+passwordHash",
      );

      if (!user) {
         console.log(`[AUTH/LOGIN] User not found: ${email}`);
         return res.status(401).json({
            success: false,
            message: "Invalid email or password",
         });
      }

      if (!user.passwordHash) {
         return res.status(401).json({
            success: false,
            message: "This account uses Google login — no password set",
         });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
         console.log(`[AUTH/LOGIN] Wrong password for: ${email}`);
         return res.status(401).json({
            success: false,
            message: "Invalid email or password",
         });
      }

      console.log(`[AUTH/LOGIN] Success for: ${email}`);
      const token = signToken(user._id);

      return res.status(200).json({
         success: true,
         token,
         user: formatUser(user),
      });
   } catch (err) {
      console.error("[AUTH/LOGIN] Error:", err.message);
      return res.status(500).json({
         success: false,
         message: "Login failed. Please try again.",
      });
   }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me — Returns current user's full profile (protected)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", protect, async (req, res) => {
   try {
      console.log(`[AUTH/ME] Fetching profile for userId: ${req.user._id}`);

      const user = await User.findById(req.user._id).select(
         "-passwordHash -likedUsers -passedUsers -pushToken",
      );

      if (!user) {
         return res
            .status(404)
            .json({ success: false, message: "User not found" });
      }

      return res.status(200).json({ success: true, user: formatUser(user) });
   } catch (err) {
      console.error("[AUTH/ME] Error:", err.message);
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/google — Placeholder until OAuth is set up
// ─────────────────────────────────────────────────────────────────────────────
router.post("/google", async (req, res) => {
   return res.status(503).json({
      success: false,
      message:
         "Google OAuth temporarily unavailable. Please use email/password login.",
   });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/push-token
// ─────────────────────────────────────────────────────────────────────────────
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
