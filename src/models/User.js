const mongoose = require("mongoose");

const endOfToday = () => {
   const now = new Date();
   now.setHours(23, 59, 59, 999);
   return now;
};

const KundliSchema = new mongoose.Schema(
   {
      nakshatra: { type: String },
      nakshatraIndex: { type: Number },
      nakshatraSymbol: { type: String },
      rashi: { type: String },
      rashiIndex: { type: Number },
      pada: { type: Number },
      animal: { type: String },
      gana: { type: String, enum: ["Deva", "Manushya", "Rakshasa"] },
      varna: {
         type: String,
         enum: ["Brahmin", "Kshatriya", "Vaishya", "Shudra"],
      },
      nadi: { type: String, enum: ["Vata", "Pitta", "Kapha"] },
      vashya: { type: String },
      lordPlanet: { type: String },
      lordIndex: { type: Number },
      moonLongitude: { type: Number },
   },
   { _id: false },
);

const BirthDetailsSchema = new mongoose.Schema(
   {
      dateOfBirth: { type: String, required: true },
      timeOfBirth: { type: String, required: true },
      placeOfBirth: { type: String, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      utcOffset: { type: Number, default: 5.5 },
   },
   { _id: false },
);

const UserSchema = new mongoose.Schema(
   {
      // ── Auth ──────────────────────────────────────
      googleId: { type: String, unique: true, sparse: true },
      email: { type: String, unique: true, required: true, lowercase: true },
      name: { type: String, required: true },
      avatar: { type: String },
      passwordHash: { type: String, select: false },

      // ── Profile ───────────────────────────────────
      bio: { type: String, maxlength: 300 },
      age: { type: Number },
      gender: { type: String, enum: ["male", "female", "other"] },
      photos: [{ type: String }],
      lookingFor: {
         type: String,
         enum: ["marriage", "dating", "both"],
         default: "both",
      },

      // ── Birth & Kundli ────────────────────────────
      birthDetails: { type: BirthDetailsSchema },
      kundli: { type: KundliSchema },

      // ── Matching Preferences ──────────────────────
      preferences: {
         minAge: { type: Number, default: 18 },
         maxAge: { type: Number, default: 45 },
         minGunaScore: { type: Number, default: 18 },
         genderPref: {
            type: String,
            enum: ["male", "female", "both"],
            default: "both",
         },
      },

      // ── Profile Views ─────────────────────────────
      profileViews: [
         {
            viewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            viewedAt: { type: Date, default: Date.now },
         },
      ],
      viewedProfiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

      // ── App State ─────────────────────────────────
      onboardingComplete: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      lastSeen: { type: Date, default: Date.now },
      pushToken: { type: String },

      // ── Premium Subscription (NEW Sprint 3) ───────
      premium: {
         isActive: { type: Boolean, default: false },
         plan: { type: String, enum: ["monthly", "annual"], default: null },
         expiresAt: { type: Date, default: null },
         revenueCatId: { type: String, default: null },
      },
      // ── Profile Boost ──────────────────────────────────────────────────────
      boost: {
         active: { type: Boolean, default: false },
         expiresAt: { type: Date, default: null },
         usedAt: { type: String, default: null }, // "YYYY-MM-DD" UTC — 1/day limit
      },
      // ── Daily Swipe Tracking (NEW Sprint 3) ───────
      swipeTracking: {
         date: { type: String, default: null }, // "YYYY-MM-DD" UTC
         count: { type: Number, default: 0 },
      },

      // ── Swipe history ─────────────────────────────
      likedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      passedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
   },
   { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
UserSchema.index({ "kundli.gana": 1 });
UserSchema.index({ "kundli.nadi": 1 });
UserSchema.index({ gender: 1, "preferences.genderPref": 1 });
UserSchema.index({ isActive: 1 });

// ── Instance Methods ──────────────────────────────────────────────────────────

// Check if user can swipe (free = 20/day, premium = unlimited)
UserSchema.methods.canSwipe = function () {
   const isPremiumUser = this.isPremium();
   if (isPremiumUser) {
      return { allowed: true, remaining: null, limit: null, isPremium: true };
   }
   const todayUTC = new Date().toISOString().split("T")[0];
   const isNewDay =
      !this.swipeTracking?.date || this.swipeTracking.date !== todayUTC;
   const count = isNewDay ? 0 : this.swipeTracking?.count || 0;
   const DAILY_LIMIT = 5;
   const remaining = Math.max(0, DAILY_LIMIT - count);
   return {
      allowed: remaining > 0,
      remaining,
      limit: DAILY_LIMIT,
      isPremium: false,
   };
};

// Increment swipe count (call after each like/pass)
UserSchema.methods.incrementSwipe = async function () {
   const todayUTC = new Date().toISOString().split("T")[0];
   const isNewDay =
      !this.swipeTracking?.date || this.swipeTracking.date !== todayUTC;
   await mongoose.model("User").findByIdAndUpdate(this._id, {
      $set: {
         "swipeTracking.date": todayUTC,
         "swipeTracking.count": isNewDay
            ? 1
            : (this.swipeTracking?.count || 0) + 1,
      },
   });
};

// Check if premium subscription is currently valid
UserSchema.methods.isPremium = function () {
   if (!this.premium?.isActive) return false;
   if (!this.premium?.expiresAt) return false;
   return new Date() < new Date(this.premium.expiresAt);
};

// Virtuals
UserSchema.virtual("ganaTitle").get(function () {
   const titles = {
      Deva: "Divine Soul ✨",
      Manushya: "Human Heart 🤝",
      Rakshasa: "Fierce Spirit 🔥",
   };
   return this.kundli ? titles[this.kundli.gana] : null;
});

module.exports = mongoose.model("User", UserSchema);
