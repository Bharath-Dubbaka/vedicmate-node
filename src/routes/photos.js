// src/routes/photos.js
// POST /api/auth/photos  — upload 1 profile photo to Cloudinary
// Uses multer with memory storage, then streams to Cloudinary.
// No multer-storage-cloudinary needed — avoids extra dep.

const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { protect } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// Configure Cloudinary from env vars
cloudinary.config({
   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
   api_key: process.env.CLOUDINARY_API_KEY,
   api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer: memory storage, 5MB limit, images only
const upload = multer({
   storage: multer.memoryStorage(),
   limits: { fileSize: 5 * 1024 * 1024 },
   fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith("image/")) {
         return cb(new Error("Only image files are allowed"), false);
      }
      cb(null, true);
   },
});

// ─────────────────────────────────────────────────────────
// POST /api/auth/photos
// Body: multipart/form-data with field "photo"
// Returns: { success, photoUrl, user }
// ─────────────────────────────────────────────────────────
router.post("/", protect, upload.single("photo"), async (req, res) => {
   try {
      if (!req.file) {
         return res
            .status(400)
            .json({ success: false, message: "No photo provided" });
      }

      const timestamp = Math.round(new Date().getTime() / 1000);
      const publicId = `user_${req.user._id}`;
      // Only sign these exact params — no transformation
      const paramsToSign = {
         folder: "vedicmate/profiles",
         overwrite: 1,
         public_id: publicId,
         timestamp,
      };
      const signature = cloudinary.utils.api_sign_request(
         paramsToSign,
         process.env.CLOUDINARY_API_SECRET,
      );

      const uploadResult = await new Promise((resolve, reject) => {
         const stream = cloudinary.uploader.upload_stream(
            {
               ...paramsToSign,
               signature,
               api_key: process.env.CLOUDINARY_API_KEY,
               transformation: [
                  { width: 800, height: 800, crop: "fill", gravity: "face" },
                  { quality: "auto", fetch_format: "auto" },
               ],
            },
            (error, result) => {
               if (error) reject(error);
               else resolve(result);
            },
         );
         stream.end(req.file.buffer);
      });

      const photoUrl = uploadResult.secure_url;

      // Save to user.photos[] — single photo, replace array
      await User.findByIdAndUpdate(req.user._id, {
         $set: { photos: [photoUrl] },
      });

      console.log(`[PHOTOS] Uploaded for user ${req.user._id}: ${photoUrl}`);

      return res.status(200).json({
         success: true,
         photoUrl,
         message: "Photo uploaded successfully",
      });
   } catch (err) {
      console.error("[PHOTOS] Upload error:", err.message);
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/auth/photos
// Remove profile photo (sets photos to [])
// ─────────────────────────────────────────────────────────
router.delete("/", protect, async (req, res) => {
   try {
      // Delete from Cloudinary too
      await cloudinary.uploader.destroy(
         `vedicmate/profiles/user_${req.user._id}`,
      );

      await User.findByIdAndUpdate(req.user._id, { $set: { photos: [] } });

      return res.status(200).json({ success: true, message: "Photo removed" });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

module.exports = router;
