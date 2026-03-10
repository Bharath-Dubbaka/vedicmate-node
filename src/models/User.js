const mongoose = require("mongoose");

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
      dateOfBirth: { type: String, required: true }, // "YYYY-MM-DD"
      timeOfBirth: { type: String, required: true }, // "HH:MM"
      placeOfBirth: { type: String, required: true }, // display name
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      utcOffset: { type: Number, default: 5.5 }, // IST default
   },
   { _id: false },
);

const UserSchema = new mongoose.Schema(
   {
      // ── Auth ──────────────────────────────────────
      googleId: { type: String, unique: true, sparse: true },
      email: { type: String, unique: true, required: true, lowercase: true },
      name: { type: String, required: true },
      avatar: { type: String }, // Google profile pic URL

      // ── Profile ───────────────────────────────────
      bio: { type: String, maxlength: 300 },
      age: { type: Number },
      gender: { type: String, enum: ["male", "female", "other"] },
      photos: [{ type: String }], // Cloudinary URLs, max 6
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
         minGunaScore: { type: Number, default: 18 }, // minimum guna to show profile
         genderPref: {
            type: String,
            enum: ["male", "female", "both"],
            default: "both",
         },
      },

      // ── App State ─────────────────────────────────
      onboardingComplete: { type: Boolean, default: false },
      isActive: { type: Boolean, default: true },
      lastSeen: { type: Date, default: Date.now },
      pushToken: { type: String }, // Expo push token

      // ── Swipe history (keep lightweight — just IDs) ──
      likedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      passedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
   },
   { timestamps: true },
);

// Index for fast matching queries
UserSchema.index({ "kundli.gana": 1 });
UserSchema.index({ "kundli.nadi": 1 });
UserSchema.index({ gender: 1, "preferences.genderPref": 1 });
UserSchema.index({ isActive: 1 });

// Virtual: display name for Gana personality
UserSchema.virtual("ganaTitle").get(function () {
   const titles = {
      Deva: "Divine Soul ✨",
      Manushya: "Human Heart 🤝",
      Rakshasa: "Fierce Spirit 🔥",
   };
   return this.kundli ? titles[this.kundli.gana] : null;
});

module.exports = mongoose.model("User", UserSchema);
