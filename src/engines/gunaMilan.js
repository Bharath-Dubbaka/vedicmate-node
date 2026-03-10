/**
 * GUNA MILAN ENGINE
 * Complete Ashta Koota (8 Koota) compatibility scoring
 * Total: 36 points
 *
 * The 8 Kootas:
 * 1. Varna    - 1 pt  - Spiritual/ego compatibility
 * 2. Vashya   - 2 pts - Mutual attraction & control
 * 3. Tara     - 3 pts - Birth star health/destiny
 * 4. Yoni     - 4 pts - Sexual/physical compatibility
 * 5. Graha Maitri - 5 pts - Mental/planet friendship
 * 6. Gana     - 6 pts - Temperament/personality
 * 7. Bhakoot  - 7 pts - Emotional/rashi compatibility
 * 8. Nadi     - 8 pts - Health & genetic compatibility
 */

const { PLANET_FRIENDSHIP, YONI_COMPATIBILITY } = require("./nakshatraLookup");

// ─────────────────────────────────────────────
// 1. VARNA (1 point max)
// Spiritual compatibility based on caste hierarchy
// ─────────────────────────────────────────────
const VARNA_RANK = { Brahmin: 4, Kshatriya: 3, Vaishya: 2, Shudra: 1 };

const scoreVarna = (nakA, nakB) => {
   const rankA = VARNA_RANK[nakA.varna];
   const rankB = VARNA_RANK[nakB.varna];
   // Male's varna should be >= female's varna
   // In app context: person A is treated as male reference
   if (rankA >= rankB)
      return { score: 1, max: 1, detail: "Compatible spiritual levels" };
   return {
      score: 0,
      max: 1,
      detail: "Different spiritual levels — minor concern",
   };
};

// ─────────────────────────────────────────────
// 2. VASHYA (2 points max)
// Mutual attraction and dominance
// ─────────────────────────────────────────────
const VASHYA_COMPATIBILITY = {
   Manav: {
      best: ["Manav"],
      friendly: ["Vanchar", "Keeta"],
      neutral: [],
      enemy: ["Chatushpad", "Jalchar"],
   },
   Chatushpad: {
      best: ["Chatushpad"],
      friendly: ["Manav"],
      neutral: ["Vanchar"],
      enemy: ["Jalchar", "Keeta"],
   },
   Jalchar: {
      best: ["Jalchar"],
      friendly: ["Manav"],
      neutral: ["Chatushpad"],
      enemy: ["Vanchar", "Keeta"],
   },
   Vanchar: {
      best: ["Vanchar"],
      friendly: ["Chatushpad"],
      neutral: ["Manav"],
      enemy: ["Jalchar", "Keeta"],
   },
   Keeta: {
      best: ["Keeta"],
      friendly: ["Manav"],
      neutral: [],
      enemy: ["Chatushpad", "Jalchar", "Vanchar"],
   },
};

const scoreVashya = (nakA, nakB) => {
   const compA = VASHYA_COMPATIBILITY[nakA.vashya];
   const vashyaB = nakB.vashya;

   if (!compA) return { score: 0, max: 2, detail: "Unknown vashya type" };

   if (compA.best.includes(vashyaB))
      return { score: 2, max: 2, detail: "Strong mutual attraction" };
   if (compA.friendly.includes(vashyaB))
      return { score: 1, max: 2, detail: "Good attraction" };
   if (compA.neutral.includes(vashyaB))
      return { score: 0.5, max: 2, detail: "Neutral attraction" };
   return { score: 0, max: 2, detail: "Weak attraction — needs effort" };
};

// ─────────────────────────────────────────────
// 3. TARA (3 points max)
// Birth star harmony — health & destiny
// ─────────────────────────────────────────────
const scoreTara = (nakA, nakB) => {
   // Count from nakA's index to nakB's index
   const diff = (((nakB.index - nakA.index) % 27) + 27) % 27;
   const taraNum = (diff % 9) + 1; // Cycle of 9

   // Auspicious taras: 1,3,5,7 → good; others → bad
   const auspicious = [1, 3, 5, 7];
   const inauspicious = [2, 4, 6, 8, 9];

   // Check both directions
   const diffReverse = (((nakA.index - nakB.index) % 27) + 27) % 27;
   const taraNums2 = (diffReverse % 9) + 1;

   const forwardGood = auspicious.includes(taraNum);
   const reverseGood = auspicious.includes(taraNums2);

   if (forwardGood && reverseGood)
      return { score: 3, max: 3, detail: "Excellent birth star harmony" };
   if (forwardGood || reverseGood)
      return { score: 1.5, max: 3, detail: "Moderate birth star harmony" };
   return { score: 0, max: 3, detail: "Challenging birth star combination" };
};

// ─────────────────────────────────────────────
// 4. YONI (4 points max)
// Sexual & physical compatibility (animal symbols)
// ─────────────────────────────────────────────
const scoreYoni = (nakA, nakB) => {
   const animalA = nakA.animal;
   const animalB = nakB.animal;
   const comp = YONI_COMPATIBILITY[animalA];

   if (!comp) return { score: 0, max: 4, detail: "Unknown Yoni" };

   // Same animal = best
   if (animalA === animalB) {
      return {
         score: 4,
         max: 4,
         detail: `Perfect Yoni match — both ${animalA} 🐾`,
      };
   }
   if (comp.best.includes(animalB)) {
      return {
         score: 4,
         max: 4,
         detail: `Excellent Yoni — ${animalA} & ${animalB} are perfectly compatible`,
      };
   }
   if (comp.friendly.includes(animalB)) {
      return {
         score: 3,
         max: 4,
         detail: `Good Yoni — ${animalA} & ${animalB} are friendly`,
      };
   }
   if (comp.neutral.includes(animalB)) {
      return {
         score: 2,
         max: 4,
         detail: `Neutral Yoni — ${animalA} & ${animalB}`,
      };
   }
   if (comp.enemy.includes(animalB)) {
      return {
         score: 1,
         max: 4,
         detail: `Tense Yoni — ${animalA} & ${animalB} are not ideal`,
      };
   }
   // worst
   return {
      score: 0,
      max: 4,
      detail: `Incompatible Yoni — ${animalA} & ${animalB} conflict`,
   };
};

// ─────────────────────────────────────────────
// 5. GRAHA MAITRI (5 points max)
// Planet lord friendship — mental compatibility
// ─────────────────────────────────────────────
const scoreGrahaMaitri = (nakA, nakB) => {
   const lordA = nakA.lordIndex;
   const lordB = nakB.lordIndex;

   if (lordA === lordB) {
      return {
         score: 5,
         max: 5,
         detail: "Same ruling planet — excellent mental sync",
      };
   }

   const friendshipA = PLANET_FRIENDSHIP[lordA];
   const friendshipB = PLANET_FRIENDSHIP[lordB];

   const AtoB = friendshipA.friends.includes(lordB)
      ? "friend"
      : friendshipA.neutral.includes(lordB)
        ? "neutral"
        : "enemy";
   const BtoA = friendshipB.friends.includes(lordA)
      ? "friend"
      : friendshipB.neutral.includes(lordA)
        ? "neutral"
        : "enemy";

   if (AtoB === "friend" && BtoA === "friend")
      return {
         score: 5,
         max: 5,
         detail: "Mutual planet friendship — great mental harmony",
      };
   if (AtoB === "friend" && BtoA === "neutral")
      return { score: 4, max: 5, detail: "Good mental compatibility" };
   if (AtoB === "neutral" && BtoA === "friend")
      return { score: 4, max: 5, detail: "Good mental compatibility" };
   if (AtoB === "neutral" && BtoA === "neutral")
      return { score: 3, max: 5, detail: "Neutral mental compatibility" };
   if (AtoB === "friend" && BtoA === "enemy")
      return { score: 1, max: 5, detail: "One-sided — requires understanding" };
   if (AtoB === "enemy" && BtoA === "friend")
      return { score: 1, max: 5, detail: "One-sided — requires understanding" };
   if (AtoB === "neutral" && BtoA === "enemy")
      return { score: 0.5, max: 5, detail: "Difficult mental alignment" };
   if (AtoB === "enemy" && BtoA === "neutral")
      return { score: 0.5, max: 5, detail: "Difficult mental alignment" };
   // Both enemies
   return {
      score: 0,
      max: 5,
      detail: "Conflicting planetary rulers — significant challenge",
   };
};

// ─────────────────────────────────────────────
// 6. GANA (6 points max)
// Temperament: Deva / Manushya / Rakshasa
// ─────────────────────────────────────────────
const scoreGana = (nakA, nakB) => {
   const ganaA = nakA.gana;
   const ganaB = nakB.gana;

   const GANA_SCORES = {
      "Deva-Deva": { score: 6, detail: "Both Deva — divine harmony ✨" },
      "Manushya-Manushya": {
         score: 6,
         detail: "Both Manushya — great human compatibility",
      },
      "Rakshasa-Rakshasa": {
         score: 6,
         detail: "Both Rakshasa — intense but deeply matched",
      },
      "Deva-Manushya": {
         score: 5,
         detail: "Deva & Manushya — compatible with effort",
      },
      "Manushya-Deva": {
         score: 5,
         detail: "Manushya & Deva — compatible with effort",
      },
      "Manushya-Rakshasa": {
         score: 1,
         detail: "Manushya & Rakshasa — clashing temperaments",
      },
      "Rakshasa-Manushya": {
         score: 1,
         detail: "Rakshasa & Manushya — clashing temperaments",
      },
      "Deva-Rakshasa": {
         score: 0,
         detail: "Deva & Rakshasa — opposite natures ⚠️",
      },
      "Rakshasa-Deva": {
         score: 0,
         detail: "Rakshasa & Deva — opposite natures ⚠️",
      },
   };

   const key = `${ganaA}-${ganaB}`;
   const result = GANA_SCORES[key] || {
      score: 0,
      detail: "Unknown gana combination",
   };
   return { ...result, max: 6 };
};

// ─────────────────────────────────────────────
// 7. BHAKOOT (7 points max)
// Rashi (moon sign) relationship
// ─────────────────────────────────────────────
const scoreBhakoot = (nakA, nakB) => {
   const rashiA = nakA.rashiIndex;
   const rashiB = nakB.rashiIndex;

   // Calculate position of B from A (1-12)
   const posAtoB = ((((rashiB - rashiA) % 12) + 12) % 12) + 1;
   const posBtoA = ((((rashiA - rashiB) % 12) + 12) % 12) + 1;

   // Inauspicious pairs: 2-12, 6-8, 5-9 (debated), 3-11
   const inauspicious = [
      [2, 12],
      [6, 8],
   ];

   for (const [p1, p2] of inauspicious) {
      if (
         (posAtoB === p1 && posBtoA === p2) ||
         (posAtoB === p2 && posBtoA === p1)
      ) {
         return {
            score: 0,
            max: 7,
            detail: `Bhakoot dosha (${p1}-${p2}) — financial/health concerns ⚠️`,
         };
      }
   }

   if (posAtoB === 7 || posBtoA === 7) {
      return {
         score: 7,
         max: 7,
         detail: "7th house relation — soulmate energy ❤️",
      };
   }
   if (posAtoB === 1) {
      return {
         score: 7,
         max: 7,
         detail: "Same rashi — deeply aligned emotions",
      };
   }
   if ([1, 3, 4, 5, 7].includes(posAtoB)) {
      return { score: 7, max: 7, detail: "Auspicious rashi relationship" };
   }

   return { score: 3.5, max: 7, detail: "Moderate rashi compatibility" };
};

// ─────────────────────────────────────────────
// 8. NADI (8 points max)
// Health & genetic compatibility — MOST IMPORTANT
// ─────────────────────────────────────────────
const scoreNadi = (nakA, nakB) => {
   const nadiA = nakA.nadi;
   const nadiB = nakB.nadi;

   if (nadiA === nadiB) {
      return {
         score: 0,
         max: 8,
         detail: `Nadi dosha — both ${nadiA} nadi ⚠️ Health/progeny concerns`,
         dosha: true,
      };
   }
   return {
      score: 8,
      max: 8,
      detail: `Different Nadis (${nadiA} & ${nadiB}) — excellent health compatibility`,
      dosha: false,
   };
};

// ─────────────────────────────────────────────
// DOSHA CHECKS
// ─────────────────────────────────────────────
const checkDoshas = (nakA, nakB) => {
   const doshas = [];

   // Nadi Dosha
   if (nakA.nadi === nakB.nadi) {
      doshas.push({
         name: "Nadi Dosha",
         severity: "High",
         description: "Same Nadi — potential health and progeny issues",
         cancellation: "Can be cancelled if both share same Nakshatra or Rashi",
      });
   }

   // Bhakoot Dosha
   const rashiA = nakA.rashiIndex;
   const rashiB = nakB.rashiIndex;
   const posAtoB = ((((rashiB - rashiA) % 12) + 12) % 12) + 1;
   const posBtoA = ((((rashiA - rashiB) % 12) + 12) % 12) + 1;
   if ((posAtoB === 6 && posBtoA === 8) || (posAtoB === 8 && posBtoA === 6)) {
      doshas.push({
         name: "Bhakoot Dosha (6-8)",
         severity: "High",
         description:
            "6-8 Bhakoot — financial difficulties and health concerns",
         cancellation: "Cancelled if lords of both rashis are friendly",
      });
   }
   if ((posAtoB === 2 && posBtoA === 12) || (posAtoB === 12 && posBtoA === 2)) {
      doshas.push({
         name: "Bhakoot Dosha (2-12)",
         severity: "Medium",
         description: "2-12 Bhakoot — financial incompatibility",
         cancellation: "Weakened if Nadi and Gana are fully compatible",
      });
   }

   // Gana Dosha
   if (
      (nakA.gana === "Deva" && nakB.gana === "Rakshasa") ||
      (nakA.gana === "Rakshasa" && nakB.gana === "Deva")
   ) {
      doshas.push({
         name: "Gana Dosha",
         severity: "Medium",
         description: "Deva-Rakshasa Gana — temperament conflicts",
         cancellation: "Mitigated by high Guna score (28+) in other areas",
      });
   }

   return doshas;
};

// ─────────────────────────────────────────────
// MAIN: CALCULATE FULL GUNA MILAN
// ─────────────────────────────────────────────
/**
 * @param {Object} nakshatraA - Nakshatra object for person A
 * @param {Object} nakshatraB - Nakshatra object for person B
 * @returns {Object} Full compatibility report
 */
const calculateGunaMilan = (nakshatraA, nakshatraB) => {
   const varna = scoreVarna(nakshatraA, nakshatraB);
   const vashya = scoreVashya(nakshatraA, nakshatraB);
   const tara = scoreTara(nakshatraA, nakshatraB);
   const yoni = scoreYoni(nakshatraA, nakshatraB);
   const grahaMaitri = scoreGrahaMaitri(nakshatraA, nakshatraB);
   const gana = scoreGana(nakshatraA, nakshatraB);
   const bhakoot = scoreBhakoot(nakshatraA, nakshatraB);
   const nadi = scoreNadi(nakshatraA, nakshatraB);

   const totalScore =
      varna.score +
      vashya.score +
      tara.score +
      yoni.score +
      grahaMaitri.score +
      gana.score +
      bhakoot.score +
      nadi.score;

   const totalMax = 36;
   const percentage = Math.round((totalScore / totalMax) * 100);

   // Verdict
   let verdict, verdictEmoji, verdictColor;
   if (totalScore >= 32) {
      verdict = "Excellent Match";
      verdictEmoji = "🌟";
      verdictColor = "#FFD700";
   } else if (totalScore >= 24) {
      verdict = "Good Match";
      verdictEmoji = "❤️";
      verdictColor = "#4CAF50";
   } else if (totalScore >= 18) {
      verdict = "Average Match";
      verdictEmoji = "🤔";
      verdictColor = "#FF9800";
   } else {
      verdict = "Challenging Match";
      verdictEmoji = "⚠️";
      verdictColor = "#F44336";
   }

   const doshas = checkDoshas(nakshatraA, nakshatraB);

   return {
      totalScore: Math.round(totalScore * 10) / 10, // round to 1 decimal
      totalMax,
      percentage,
      verdict,
      verdictEmoji,
      verdictColor,
      doshas,
      breakdown: {
         varna: {
            ...varna,
            name: "Varna",
            description: "Spiritual compatibility",
         },
         vashya: {
            ...vashya,
            name: "Vashya",
            description: "Mutual attraction",
         },
         tara: { ...tara, name: "Tara", description: "Birth star harmony" },
         yoni: { ...yoni, name: "Yoni", description: "Physical compatibility" },
         grahaMaitri: {
            ...grahaMaitri,
            name: "Graha Maitri",
            description: "Mental compatibility",
         },
         gana: { ...gana, name: "Gana", description: "Temperament match" },
         bhakoot: {
            ...bhakoot,
            name: "Bhakoot",
            description: "Emotional compatibility",
         },
         nadi: { ...nadi, name: "Nadi", description: "Health compatibility" },
      },
      // Nakshatra profiles
      profileA: {
         nakshatra: nakshatraA.name,
         symbol: nakshatraA.symbol,
         animal: nakshatraA.animal,
         gana: nakshatraA.gana,
         rashi: nakshatraA.rashi,
         nadi: nakshatraA.nadi,
      },
      profileB: {
         nakshatra: nakshatraB.name,
         symbol: nakshatraB.symbol,
         animal: nakshatraB.animal,
         gana: nakshatraB.gana,
         rashi: nakshatraB.rashi,
         nadi: nakshatraB.nadi,
      },
   };
};

module.exports = {
   calculateGunaMilan,
   scoreVarna,
   scoreVashya,
   scoreTara,
   scoreYoni,
   scoreGrahaMaitri,
   scoreGana,
   scoreBhakoot,
   scoreNadi,
   checkDoshas,
};
