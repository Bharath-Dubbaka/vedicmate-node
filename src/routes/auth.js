// src/routes/auth.js
// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE AUTH ADDITION:
//   POST /api/auth/google
//   Receives { googleId, email, name, avatar } from frontend
//   Creates or finds existing user, returns JWT
//
//   No passport needed — we verify the user via Google's userinfo API
//   on the frontend (expo-auth-session), then trust the result here.
//   For production hardening, you'd verify the access token server-side too.
// ─────────────────────────────────────────────────────────────────────────────

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
  photos: user.photos || [], // photo persisted in user doc for easy access
  onboardingComplete: user.onboardingComplete,
  kundli: user.kundli || null,
  preferences: user.preferences || null,
  gender: user.gender || null,
  bio: user.bio || null,
  lookingFor: user.lookingFor || null,
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
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
      // If they have a Google account with this email, tell them to use Google
      if (existing.googleId && !existing.passwordHash) {
        return res.status(409).json({
          success: false,
          message:
            "This email is linked to a Google account. Please sign in with Google.",
        });
      }
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
      passwordHash,
      onboardingComplete: false,
    });

    console.log(`[AUTH/REGISTER] User created: ${user._id} (${email})`);
    const token = signToken(user._id);

    return res
      .status(201)
      .json({ success: true, token, user: formatUser(user) });
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

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+passwordHash"
    );

    if (!user) {
      console.log(`[AUTH/LOGIN] User not found: ${email}`);
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    if (!user.passwordHash) {
      return res.status(401).json({
        success: false,
        message: "This account uses Google login — please sign in with Google",
      });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      console.log(`[AUTH/LOGIN] Wrong password for: ${email}`);
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    console.log(`[AUTH/LOGIN] Success for: ${email}`);
    const token = signToken(user._id);

    return res
      .status(200)
      .json({ success: true, token, user: formatUser(user) });
  } catch (err) {
    console.error("[AUTH/LOGIN] Error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Login failed. Please try again." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/google  ← NEW
//
// Called after expo-auth-session completes the OAuth flow on the frontend.
// Frontend sends: { googleId, email, name, avatar }
//
// Logic:
//   1. Look up user by googleId OR email
//   2. If found by email but no googleId → link Google to existing account
//   3. If not found → create new user (skip password, set googleId)
//   4. Return JWT + user (same format as email/password login)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/google", async (req, res) => {
  try {
    const { googleId, email, name, avatar } = req.body;

    if (!googleId || !email) {
      return res.status(400).json({
        success: false,
        message: "googleId and email are required",
      });
    }

    console.log(
      `[AUTH/GOOGLE] Attempt for email: ${email}, googleId: ${googleId}`
    );

    // Try to find existing user
    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
    });

    if (user) {
      // Link Google ID if they previously registered with email/password
      if (!user.googleId) {
        user.googleId = googleId;
        if (avatar && !user.avatar) user.avatar = avatar;
        await user.save();
        console.log(
          `[AUTH/GOOGLE] Linked Google to existing account: ${email}`
        );
      } else {
        // Update avatar if changed
        if (avatar && user.avatar !== avatar) {
          user.avatar = avatar;
          await user.save();
        }
        console.log(`[AUTH/GOOGLE] Existing Google user: ${email}`);
      }
    } else {
      // New user — create account without password
      user = await User.create({
        googleId,
        email: email.toLowerCase().trim(),
        name: name?.trim() || email.split("@")[0],
        avatar: avatar || null,
        onboardingComplete: false,
        // No passwordHash — Google-only account
      });
      console.log(`[AUTH/GOOGLE] New user created: ${user._id} (${email})`);
    }

    const token = signToken(user._id);

    return res.status(200).json({
      success: true,
      token,
      user: formatUser(user),
      isNewUser: !user.onboardingComplete, // frontend can use this to skip to onboarding
    });
  } catch (err) {
    console.error("[AUTH/GOOGLE] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Google sign-in failed. Please try again.",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", protect, async (req, res) => {
  try {
    console.log(`[AUTH/ME] Fetching profile for userId: ${req.user._id}`);

    const user = await User.findById(req.user._id).select(
      "-passwordHash -likedUsers -passedUsers -pushToken"
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
// PATCH /api/auth/me
// Now accepts: bio, preferences, name, age
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/me", protect, async (req, res) => {
  try {
    const { bio, preferences, name, age } = req.body;

    const updates = {};
    if (bio !== undefined) updates.bio = bio.trim().slice(0, 300);
    if (preferences !== undefined) updates.preferences = preferences;
    if (name !== undefined && name.trim())
      updates.name = name.trim().slice(0, 50);
    if (age !== undefined) {
      const parsedAge = parseInt(age);
      if (parsedAge >= 18 && parsedAge <= 100) updates.age = parsedAge;
    }

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No updatable fields provided" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true }
    ).select(
      "name email bio gender age kundli preferences lookingFor onboardingComplete"
    );

    return res
      .status(200)
      .json({ success: true, message: "Profile updated", user });
  } catch (err) {
    console.error("PATCH /me error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
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
// POST /api/auth/photo  ← Add a photo (max 3)
// ─────────────────────────────────────────────────────────────────────────────
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

router.post("/photo", protect, upload.single("photo"), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("photos");
    if (user.photos.length >= 3) {
      return res.status(400).json({
        success: false,
        message: "Maximum 3 photos allowed. Delete one first.",
      });
    }

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    // Upload to Cloudinary — unchanged
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "vedicfind/photos",
          transformation: [
            { width: 800, height: 800, crop: "fill", gravity: "face" },
            { quality: "auto" },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    const photoUrl = result.secure_url;

    // ── Slot-aware photo update ──────────────────────────────────────────
    const slot = parseInt(req.body.slot);
    const photos = [...(user.photos || [])];

    if (!isNaN(slot) && slot >= 0 && slot <= 2) {
      // Delete old Cloudinary image at this slot if it exists
      if (photos[slot]) {
        try {
          const oldPublicId = photos[slot]
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];
          await cloudinary.uploader.destroy(oldPublicId);
        } catch {
          /* ignore cloudinary cleanup errors */
        }
      }
      // Insert/replace at exact slot
      photos[slot] = photoUrl;
    } else {
      // No slot specified — fallback: append if under 3
      if (photos.length >= 3) {
        return res.status(400).json({
          success: false,
          message: "Maximum 3 photos allowed. Delete one first.",
        });
      }
      photos.push(photoUrl);
    }

    await User.findByIdAndUpdate(req.user._id, { $set: { photos } });
    // ────────────────────────────────────────────────────────────────────

    return res.status(200).json({ success: true, photoUrl, photos });
  } catch (err) {
    console.error("[AUTH/PHOTO] Upload error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/auth/photo  ← Remove a photo by URL
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/photo", protect, async (req, res) => {
  try {
    const { photoUrl } = req.body;
    if (!photoUrl) {
      return res
        .status(400)
        .json({ success: false, message: "photoUrl required" });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { photos: photoUrl } },
      { new: true }
    ).select("photos");

    // Delete from Cloudinary
    try {
      const publicId = photoUrl.split("/").slice(-2).join("/").split(".")[0];
      await cloudinary.uploader.destroy(publicId);
    } catch (cloudErr) {
      console.warn("[AUTH/PHOTO] Cloudinary delete failed:", cloudErr.message);
    }

    return res.status(200).json({ success: true, photos: user.photos });
  } catch (err) {
    console.error("[AUTH/PHOTO] Delete error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/push-token
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/push-token", protect, async (req, res) => {
  try {
    const { pushToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { pushToken });
    return res.status(200).json({ success: true, message: "Push token saved" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
