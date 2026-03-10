// src/routes/chat.js
const express = require("express");
const Match = require("../models/Match");
const Message = require("../models/Message");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// ─────────────────────────────────────────────────────────
// GET /api/chat/:matchId/messages
// Fetch paginated message history for a match
// Query: ?limit=30&before=<messageId>  (cursor pagination)
// ─────────────────────────────────────────────────────────
router.get("/:matchId/messages", async (req, res) => {
   try {
      const { limit = 30, before } = req.query;

      // Verify this user is part of the match
      const match = await Match.findOne({
         _id: req.params.matchId,
         users: req.user._id,
         status: "matched",
      });
      if (!match) {
         return res
            .status(404)
            .json({ success: false, message: "Match not found" });
      }

      const query = {
         matchId: req.params.matchId,
         deletedFor: { $ne: req.user._id },
         ...(before && { _id: { $lt: before } }),
      };

      const messages = await Message.find(query)
         .sort({ createdAt: -1 })
         .limit(parseInt(limit))
         .populate("sender", "name avatar")
         .lean();

      // Mark unread messages as read
      await Message.updateMany(
         {
            matchId: req.params.matchId,
            sender: { $ne: req.user._id },
            "readBy.user": { $ne: req.user._id },
         },
         { $push: { readBy: { user: req.user._id, at: new Date() } } },
      );

      // Reset unread count for this user on the match
      await Match.findByIdAndUpdate(req.params.matchId, {
         $set: { [`unreadCount.${req.user._id}`]: 0 },
      });

      return res.status(200).json({
         success: true,
         messages: messages.reverse(), // oldest first for display
         hasMore: messages.length === parseInt(limit),
      });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// POST /api/chat/:matchId/messages
// Send a message via REST (Socket.io handles real-time)
// Body: { text, type }
// ─────────────────────────────────────────────────────────
router.post("/:matchId/messages", async (req, res) => {
   try {
      const { text, type = "text" } = req.body;

      if (!text?.trim() && type === "text") {
         return res
            .status(400)
            .json({ success: false, message: "Message text is required" });
      }

      const match = await Match.findOne({
         _id: req.params.matchId,
         users: req.user._id,
         status: "matched",
      });
      if (!match) {
         return res.status(404).json({
            success: false,
            message: "Match not found or not yet matched",
         });
      }

      // Create message
      const message = await Message.create({
         matchId: req.params.matchId,
         sender: req.user._id,
         type,
         text: text?.trim(),
      });

      await message.populate("sender", "name avatar");

      // Update match's lastMessage + increment other user's unread
      const otherId = match.getOtherUser(req.user._id).toString();
      const currentUnread = match.unreadCount?.get(otherId) || 0;

      await Match.findByIdAndUpdate(req.params.matchId, {
         lastMessage: {
            text: text?.trim(),
            sender: req.user._id,
            at: new Date(),
            read: false,
         },
         $set: { [`unreadCount.${otherId}`]: currentUnread + 1 },
      });

      return res.status(201).json({ success: true, message });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

// ─────────────────────────────────────────────────────────
// DELETE /api/chat/:matchId/messages/:messageId
// Delete a message for myself only
// ─────────────────────────────────────────────────────────
router.delete("/:matchId/messages/:messageId", async (req, res) => {
   try {
      const message = await Message.findOne({
         _id: req.params.messageId,
         matchId: req.params.matchId,
         sender: req.user._id, // can only delete own messages
      });

      if (!message) {
         return res
            .status(404)
            .json({ success: false, message: "Message not found" });
      }

      message.deletedFor.push(req.user._id);
      await message.save();

      return res
         .status(200)
         .json({ success: true, message: "Message deleted" });
   } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
   }
});

module.exports = router;
