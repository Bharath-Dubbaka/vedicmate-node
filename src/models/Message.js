const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
   {
      // ── References ────────────────────────────────
      matchId: {
         type: mongoose.Schema.Types.ObjectId,
         ref: "Match",
         required: true,
         index: true,
      },
      sender: {
         type: mongoose.Schema.Types.ObjectId,
         ref: "User",
         required: true,
      },

      // ── Content ───────────────────────────────────
      type: {
         type: String,
         enum: ["text", "image", "kundli_share", "system"],
         default: "text",
      },
      text: { type: String, maxlength: 1000 },
      imageUrl: { type: String }, // for image messages

      // Special: "kundli_share" type — when user shares their full Kundli
      kundliData: { type: mongoose.Schema.Types.Mixed },

      // ── Read Receipts ─────────────────────────────
      readBy: [
         {
            user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            at: { type: Date },
         },
      ],

      // ── Soft Delete ───────────────────────────────
      deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
   },
   { timestamps: true },
);

// Index for fetching chat history (match + time)
MessageSchema.index({ matchId: 1, createdAt: -1 });

// Virtual: is this message deleted for a user
MessageSchema.methods.isDeletedFor = function (userId) {
   return this.deletedFor.some((id) => id.toString() === userId.toString());
};

module.exports = mongoose.model("Message", MessageSchema);
