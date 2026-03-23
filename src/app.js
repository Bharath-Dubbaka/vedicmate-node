// src/app.js
// SPRINT 3: Added premium routes + raw body middleware for RC webhook

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const connectDB = require("./config/db");
const { initSocket } = require("./config/socket");

const authRoutes = require("./routes/auth");
const onboardingRoutes = require("./routes/onboarding");
const matchingRoutes = require("./routes/matching");
const chatRoutes = require("./routes/chat");
const premiumRoutes = require("./routes/premium"); // SPRINT 3
const photoRoutes = require("./routes/photos");

const app = express();
const server = http.createServer(app);

connectDB();

app.use(cors({ origin: "*" }));

// ── IMPORTANT: Raw body for RevenueCat webhook MUST come before express.json() ──
// RevenueCat sends HMAC-SHA256 signature over the raw body.
// If express.json() parses it first, the raw buffer is lost and sig verification fails.
app.use("/api/premium/webhook", express.raw({ type: "application/json" }));

// Standard JSON parsing for all other routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) =>
   res.json({ status: "ok", app: "VedicMate API", time: new Date() }),
);

app.use("/api/auth", authRoutes);
app.use("/api/auth/photos", photoRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/matching", matchingRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/premium", premiumRoutes);

if (process.env.NODE_ENV !== "production") {
   app.use("/api/debug", require("./routes/debug"));
}

app.use((req, res) =>
   res
      .status(404)
      .json({ success: false, message: `Route ${req.originalUrl} not found` }),
);

app.use((err, req, res, next) => {
   console.error(err);
   res.status(500).json({ success: false, message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
   console.log(`🚀 VedicMate API running on port ${PORT}`);
   initSocket(server);
   console.log("🔌 Socket.io ready");
});
