const mongoose = require("mongoose");

const GunaBreakdownSchema = new mongoose.Schema(
   {
      varna: { score: Number, max: Number, detail: String },
      vashya: { score: Number, max: Number, detail: String },
      tara: { score: Number, max: Number, detail: String },
      yoni: { score: Number, max: Number, detail: String },
      grahaMaitri: { score: Number, max: Number, detail: String },
      gana: { score: Number, max: Number, detail: String },
      bhakoot: { score: Number, max: Number, detail: String },
      nadi: { score: Number, max: Number, detail: String },
   },
   { _id: false },
);

const DoshaSchema = new mongoose.Schema(
   {
      name: { type: String },
      severity: { type: String, enum: ["High", "Medium", "Low"] },
      description: { type: String },
      cancellation: { type: String },
   },
   { _id: false },
);

const MatchSchema = new mongoose.Schema(
   {
      // ── Participants ──────────────────────────────
      users: [
         {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
         },
      ], // Always exactly 2 users

      // ── Swipe State ───────────────────────────────
      // Who has liked whom
      likes: [
         {
            from: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            at: { type: Date, default: Date.now },
         },
      ],

      // Match status
      status: {
         type: String,
         enum: [
            "pending", // one person liked, waiting for other
            "matched", // both liked — it's a match! 🎉
            "blocked", // one user blocked the other
            "expired", // no action for X days
         ],
         default: "pending",
      },

      matchedAt: { type: Date }, // when it became mutual

      // ── Guna Milan Score ──────────────────────────
      gunaScore: { type: Number, required: true }, // out of 36
      gunaMax: { type: Number, default: 36 },
      gunaPercentage: { type: Number },
      verdict: { type: String }, // "Good Match" etc
      verdictEmoji: { type: String },
      breakdown: { type: GunaBreakdownSchema },
      doshas: [DoshaSchema],

      // ── Chat ──────────────────────────────────────
      lastMessage: {
         text: { type: String },
         sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
         at: { type: Date },
         read: { type: Boolean, default: false },
      },
      unreadCount: {
         // { userId: count }
         type: Map,
         of: Number,
         default: {},
      },
   },
   { timestamps: true },
);

// Ensure we never duplicate a pair
// MatchSchema.index({ users: 1 }, { unique: true });
// No unique index on users array — uniqueness is enforced by the $all query + application logic
//The Match.findOne({ users: { $all: sortedIds } }) lookup already ensures you find existing matches before creating new ones. The unique index is redundant AND broken for arrays.

MatchSchema.index({ status: 1 });
MatchSchema.index({ gunaScore: -1 });

// Helper: check if a specific user has liked in this match
MatchSchema.methods.hasLiked = function (userId) {
   return this.likes.some((l) => l.from.toString() === userId.toString());
};

// Helper: get the other user in the match
MatchSchema.methods.getOtherUser = function (userId) {
   return this.users.find((u) => u.toString() !== userId.toString());
};

module.exports = mongoose.model("Match", MatchSchema);
