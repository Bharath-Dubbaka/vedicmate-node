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

const app = express();
const server = http.createServer(app);

connectDB();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) =>
   res.json({ status: "ok", app: "VedicMate API", time: new Date() }),
);

app.use("/api/auth", authRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/matching", matchingRoutes);
app.use("/api/chat", chatRoutes);
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
