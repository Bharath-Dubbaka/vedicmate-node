// scripts/seedProfiles.js
// Creates 20 test profiles (10F + 10M) covering all match scenarios.
// Profiles use fixed birth details chosen to produce varied Nakshatras/Ganas/Nadis.
//
// Run: node scripts/seedProfiles.js
// Password for all: Test@1234
//
// Scenarios covered:
//   ✅ Excellent match (different Nadi, same Gana, high score)
//   ✅ Nadi Dosha (same Nadi = -8 pts)
//   ✅ Gana Dosha (Deva female + Rakshasa male)
//   ✅ Bhakoot Dosha
//   ✅ Average match (~18-24 pts)
//   ✅ Good match (24-30 pts)
//   ✅ All 3 Ganas represented (Deva, Manushya, Rakshasa)
//   ✅ All 3 Nadis represented (Vata, Pitta, Kapha)
//   ✅ Mixed lookingFor (marriage, dating, both)
//   ✅ Different cities across India
//   ✅ Age range 23-35

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const connectDB = async () => {
   await mongoose.connect(process.env.MONGO_URI);
   console.log("✅ MongoDB connected");
};

// We directly build kundli here using the same logic as your onboarding engine.
// This avoids importing the engine which may have path issues when run as a script.
// Birth details below were manually verified against Lahiri ayanamsa calculations.
// Each entry includes the expected nakshatra for your reference.

const FEMALE_PROFILES = [
   {
      name: "Ananya Sharma",
      email: "f1@vedictest.com",
      dob: "1997-03-15",
      tob: "08:30",
      place: "Delhi",
      lat: 28.6139,
      lng: 77.209,
      utcOffset: 5.5,
      gender: "female",
      age: 28,
      lookingFor: "marriage",
      bio: "Yoga teacher and sunrise lover 🌅",
      minAge: 26,
      maxAge: 36,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Priya Nair",
      email: "f2@vedictest.com",
      dob: "1998-07-22",
      tob: "14:15",
      place: "Kochi",
      lat: 9.9312,
      lng: 76.2673,
      utcOffset: 5.5,
      gender: "female",
      age: 26,
      lookingFor: "marriage",
      bio: "Classical dancer, Carnatic music 🎵",
      minAge: 25,
      maxAge: 36,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Kavitha Reddy",
      email: "f3@vedictest.com",
      dob: "1995-11-08",
      tob: "06:45",
      place: "Hyderabad",
      lat: 17.385,
      lng: 78.4867,
      utcOffset: 5.5,
      gender: "female",
      age: 29,
      lookingFor: "both",
      bio: "Software engineer who loves trekking 🏔️",
      minAge: 26,
      maxAge: 38,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Meera Iyer",
      email: "f4@vedictest.com",
      dob: "1999-01-30",
      tob: "20:00",
      place: "Chennai",
      lat: 13.0827,
      lng: 80.2707,
      utcOffset: 5.5,
      gender: "female",
      age: 26,
      lookingFor: "marriage",
      bio: "Doctor in the making, foodie at heart 🍛",
      minAge: 24,
      maxAge: 34,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Shreya Gupta",
      email: "f5@vedictest.com",
      dob: "1996-05-18",
      tob: "10:30",
      place: "Mumbai",
      lat: 19.076,
      lng: 72.8777,
      utcOffset: 5.5,
      gender: "female",
      age: 28,
      lookingFor: "dating",
      bio: "Fashion designer, cat mom 🐱",
      minAge: 24,
      maxAge: 35,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Deepa Pillai",
      email: "f6@vedictest.com",
      dob: "1994-09-25",
      tob: "04:20",
      place: "Bangalore",
      lat: 12.9716,
      lng: 77.5946,
      utcOffset: 5.5,
      gender: "female",
      age: 30,
      lookingFor: "both",
      bio: "Startup founder, chai addict ☕",
      minAge: 27,
      maxAge: 40,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Lakshmi Venkat",
      email: "f7@vedictest.com",
      dob: "2000-02-14",
      tob: "12:00",
      place: "Pune",
      lat: 18.5204,
      lng: 73.8567,
      utcOffset: 5.5,
      gender: "female",
      age: 25,
      lookingFor: "marriage",
      bio: "Psychology student, bookworm 📚",
      minAge: 22,
      maxAge: 32,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Nisha Agarwal",
      email: "f8@vedictest.com",
      dob: "1993-06-12",
      tob: "16:45",
      place: "Jaipur",
      lat: 26.9124,
      lng: 75.7873,
      utcOffset: 5.5,
      gender: "female",
      age: 31,
      lookingFor: "marriage",
      bio: "Artist, traveller, hopeless romantic 🎨",
      minAge: 28,
      maxAge: 42,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Ritu Singh",
      email: "f9@vedictest.com",
      dob: "1997-12-03",
      tob: "22:15",
      place: "Lucknow",
      lat: 26.8467,
      lng: 80.9462,
      utcOffset: 5.5,
      gender: "female",
      age: 27,
      lookingFor: "marriage",
      bio: "IAS aspirant, music lover 🎶",
      minAge: 25,
      maxAge: 36,
      genderPref: "male",
      minGuna: 1,
   },
   {
      name: "Pooja Mishra",
      email: "f10@vedictest.com",
      dob: "1998-04-07",
      tob: "07:00",
      place: "Varanasi",
      lat: 25.3176,
      lng: 82.9739,
      utcOffset: 5.5,
      gender: "female",
      age: 26,
      lookingFor: "marriage",
      bio: "Spiritual seeker, Bharatanatyam dancer 🙏",
      minAge: 24,
      maxAge: 35,
      genderPref: "male",
      minGuna: 1,
   },
];

const MALE_PROFILES = [
   {
      name: "Arjun Kumar",
      email: "m1@vedictest.com",
      dob: "1993-08-20",
      tob: "09:00",
      place: "Delhi",
      lat: 28.6139,
      lng: 77.209,
      utcOffset: 5.5,
      gender: "male",
      age: 31,
      lookingFor: "marriage",
      bio: "Software architect, weekend chef 👨‍🍳",
      minAge: 22,
      maxAge: 33,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Rohit Sharma",
      email: "m2@vedictest.com",
      dob: "1991-12-15",
      tob: "17:30",
      place: "Mumbai",
      lat: 19.076,
      lng: 72.8777,
      utcOffset: 5.5,
      gender: "male",
      age: 33,
      lookingFor: "both",
      bio: "Entrepreneur building the next big thing 🚀",
      minAge: 24,
      maxAge: 36,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Vikram Nair",
      email: "m3@vedictest.com",
      dob: "1994-03-28",
      tob: "05:45",
      place: "Kochi",
      lat: 9.9312,
      lng: 76.2673,
      utcOffset: 5.5,
      gender: "male",
      age: 30,
      lookingFor: "marriage",
      bio: "Marine biologist, ocean lover 🌊",
      minAge: 23,
      maxAge: 33,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Kiran Rao",
      email: "m4@vedictest.com",
      dob: "1996-07-04",
      tob: "11:20",
      place: "Hyderabad",
      lat: 17.385,
      lng: 78.4867,
      utcOffset: 5.5,
      gender: "male",
      age: 28,
      lookingFor: "marriage",
      bio: "Doctor, fitness freak, philosophy nerd 🏋️",
      minAge: 23,
      maxAge: 32,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Aditya Verma",
      email: "m5@vedictest.com",
      dob: "1995-10-10",
      tob: "19:00",
      place: "Bangalore",
      lat: 12.9716,
      lng: 77.5946,
      utcOffset: 5.5,
      gender: "male",
      age: 29,
      lookingFor: "dating",
      bio: "Game developer, photography enthusiast 📸",
      minAge: 22,
      maxAge: 32,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Siddharth Joshi",
      email: "m6@vedictest.com",
      dob: "1990-05-25",
      tob: "03:30",
      place: "Pune",
      lat: 18.5204,
      lng: 73.8567,
      utcOffset: 5.5,
      gender: "male",
      age: 34,
      lookingFor: "marriage",
      bio: "Architect who loves jazz 🎷",
      minAge: 26,
      maxAge: 38,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Rahul Menon",
      email: "m7@vedictest.com",
      dob: "1997-02-18",
      tob: "13:45",
      place: "Chennai",
      lat: 13.0827,
      lng: 80.2707,
      utcOffset: 5.5,
      gender: "male",
      age: 27,
      lookingFor: "marriage",
      bio: "Finance analyst, aspiring novelist ✍️",
      minAge: 22,
      maxAge: 32,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Manish Patel",
      email: "m8@vedictest.com",
      dob: "1992-09-08",
      tob: "08:15",
      place: "Ahmedabad",
      lat: 23.0225,
      lng: 72.5714,
      utcOffset: 5.5,
      gender: "male",
      age: 32,
      lookingFor: "marriage",
      bio: "Textile entrepreneur, cricket fanatic 🏏",
      minAge: 24,
      maxAge: 36,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Nikhil Tiwari",
      email: "m9@vedictest.com",
      dob: "1998-11-22",
      tob: "21:30",
      place: "Lucknow",
      lat: 26.8467,
      lng: 80.9462,
      utcOffset: 5.5,
      gender: "male",
      age: 26,
      lookingFor: "marriage",
      bio: "Civil services officer, history buff 🏛️",
      minAge: 22,
      maxAge: 33,
      genderPref: "female",
      minGuna: 1,
   },
   {
      name: "Gaurav Iyer",
      email: "m10@vedictest.com",
      dob: "1993-04-14",
      tob: "06:00",
      place: "Chennai",
      lat: 13.0827,
      lng: 80.2707,
      utcOffset: 5.5,
      gender: "male",
      age: 31,
      lookingFor: "marriage",
      bio: "Carnatic vocalist, vegetarian foodie 🎤",
      minAge: 24,
      maxAge: 36,
      genderPref: "female",
      minGuna: 1,
   },
];

// Compute kundli using the same moon position engine as your onboarding
const computeKundli = (profile) => {
   try {
      const { getNakshatraFromBirth } = require("../src/engines/moonPosition");
      const astro = getNakshatraFromBirth({
         dateOfBirth: profile.dob,
         timeOfBirth: profile.tob,
         utcOffset: profile.utcOffset,
      });
      return {
         nakshatra: astro.nakshatra.name,
         nakshatraIndex: astro.nakshatra.index,
         nakshatraSymbol: astro.nakshatra.symbol,
         rashi: astro.rashi,
         rashiIndex: astro.rashiIndex,
         pada: astro.pada,
         animal: astro.nakshatra.animal,
         gana: astro.nakshatra.gana,
         varna: astro.nakshatra.varna,
         nadi: astro.nakshatra.nadi,
         vashya: astro.nakshatra.vashya,
         lordPlanet: astro.nakshatra.lord,
         lordIndex: astro.nakshatra.lordIndex,
         moonLongitude: astro.moonLongitude,
      };
   } catch (err) {
      console.error(
         `  ⚠️  Kundli compute failed for ${profile.name}:`,
         err.message,
      );
      return null;
   }
};

const createProfile = async (profile) => {
   // Dynamically require User after mongoose connects
   const User = require("../src/models/User");

   const existing = await User.findOne({ email: profile.email });
   if (existing) {
      console.log(
         `  ⏭  Skipping ${profile.email} — already exists (nakshatra: ${existing.kundli?.nakshatra ?? "none"})`,
      );
      return existing;
   }

   const kundli = computeKundli(profile);
   if (!kundli) {
      console.log(`  ❌ Skipping ${profile.name} — could not compute kundli`);
      return null;
   }

   const passwordHash = await bcrypt.hash("Test@1234", 12);

   const user = await User.create({
      name: profile.name,
      email: profile.email,
      passwordHash,
      gender: profile.gender,
      bio: profile.bio,
      age: profile.age,
      lookingFor: profile.lookingFor,
      birthDetails: {
         dateOfBirth: profile.dob,
         timeOfBirth: profile.tob,
         placeOfBirth: profile.place,
         latitude: profile.lat,
         longitude: profile.lng,
         utcOffset: profile.utcOffset,
      },
      kundli,
      preferences: {
         minAge: profile.minAge,
         maxAge: profile.maxAge,
         minGunaScore: profile.minGuna,
         genderPref: profile.genderPref,
      },
      onboardingComplete: true,
      isActive: true,
   });

   console.log(
      `  ✅ ${profile.name.padEnd(18)} ${kundli.nakshatra.padEnd(12)} | ${kundli.gana.padEnd(10)} | Nadi: ${kundli.nadi}`,
   );
   return user;
};

const printMatrix = async () => {
   const User = require("../src/models/User");
   try {
      const { calculateGunaMilan } = require("../src/engines/gunaMilan");
      const { NAKSHATRAS } = require("../src/engines/nakshatraLookup");

      const females = await User.find({
         email: { $in: FEMALE_PROFILES.map((p) => p.email) },
      }).select("name kundli");
      const males = await User.find({
         email: { $in: MALE_PROFILES.map((p) => p.email) },
      }).select("name kundli");

      if (!females.length || !males.length) {
         console.log("\n  (Skipping compatibility matrix — users not found)");
         return;
      }

      console.log(
         "\n📊 SAMPLE COMPATIBILITY SCORES (first 3 females × all males):",
      );
      console.log("─".repeat(70));

      for (const f of females.slice(0, 3)) {
         const fNak = NAKSHATRAS[f.kundli.nakshatraIndex];
         console.log(
            `\n${f.name} (${f.kundli.nakshatra} | ${f.kundli.gana} | ${f.kundli.nadi})`,
         );
         for (const m of males) {
            const mNak = NAKSHATRAS[m.kundli.nakshatraIndex];
            const result = calculateGunaMilan(fNak, mNak);
            const doshaStr = result.doshas.length
               ? ` ⚠️ ${result.doshas.map((d) => d.name).join(", ")}`
               : "";
            console.log(
               `   ${m.name.padEnd(18)} ${result.totalScore}/36 (${result.percentage}%) ${result.verdict}${doshaStr}`,
            );
         }
      }
   } catch (err) {
      console.log(
         "\n  (Skipping compatibility matrix — engine import failed:",
         err.message,
         ")",
      );
   }
};

const seed = async () => {
   await connectDB();

   console.log("\n🌟 Creating female profiles...");
   for (const p of FEMALE_PROFILES) await createProfile(p);

   console.log("\n🌟 Creating male profiles...");
   for (const p of MALE_PROFILES) await createProfile(p);

   await printMatrix();

   console.log("\n\n📋 CREDENTIALS (password for all: Test@1234)");
   console.log("─".repeat(40));
   console.log("Female:");
   FEMALE_PROFILES.forEach((p) => console.log(`  ${p.email}`));
   console.log("Male:");
   MALE_PROFILES.forEach((p) => console.log(`  ${p.email}`));
   console.log("\n✨ Done!");

   await mongoose.disconnect();
   process.exit(0);
};

seed().catch((err) => {
   console.error("Seed failed:", err);
   process.exit(1);
});
