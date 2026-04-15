// src/models/Report.js
const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema(
  {
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reported: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: {
      type: String,
      enum: ["fake", "spam", "offensive", "underage", "other"],
      required: true,
    },
    reviewed: { type: Boolean, default: false },
    notes: { type: String }, // for admin use
  },
  { timestamps: true }
);

ReportSchema.index({ reporter: 1, reported: 1 });
ReportSchema.index({ reviewed: 1, createdAt: -1 });

module.exports = mongoose.model("Report", ReportSchema);
