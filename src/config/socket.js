const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Message = require("../models/Message");
const Match = require("../models/Match");
const User = require("../models/User");

const onlineUsers = new Map();

const initSocket = (httpServer) => {
   const io = new Server(httpServer, {
      cors: { origin: "*" },
      pingTimeout: 60000,
      pingInterval: 25000,
   });

   io.use(async (socket, next) => {
      try {
         const token = socket.handshake.auth?.token;
         if (!token) return next(new Error("No token"));
         const decoded = jwt.verify(token, process.env.JWT_SECRET);
         const user = await User.findById(decoded.id).select("name");
         if (!user) return next(new Error("User not found"));
         socket.userId = decoded.id.toString();
         socket.userName = user.name;
         next();
      } catch {
         next(new Error("Invalid token"));
      }
   });

   io.on("connection", (socket) => {
      onlineUsers.set(socket.userId, socket.id);
      console.log(`🟢 ${socket.userName} connected`);
      socket.broadcast.emit("user:online", { userId: socket.userId });

      socket.on("join:matches", (matchIds) => {
         if (Array.isArray(matchIds))
            matchIds.forEach((id) => socket.join(`match:${id}`));
      });

      socket.on("message:send", async ({ matchId, text, tempId }, cb) => {
         try {
            const match = await Match.findOne({
               _id: matchId,
               users: socket.userId,
               status: "matched",
            });
            if (!match) return cb?.({ error: "Match not found" });
            const otherId = match.getOtherUser(socket.userId).toString();

            // Fetch sender's push token to compare
            const sender = await User.findById(socket.userId).select(
               "pushToken",
            );


            const msg = await Message.create({
               matchId,
               sender: socket.userId,
               text: text.trim(),
            });
            const unread = match.unreadCount?.get(otherId) || 0;

            await Match.findByIdAndUpdate(matchId, {
               lastMessage: {
                  text: text.trim(),
                  sender: socket.userId,
                  at: new Date(),
                  read: false,
               },
               $set: { [`unreadCount.${otherId}`]: unread + 1 },
            });

            io.to(`match:${matchId}`).emit("message:new", {
               _id: msg._id,
               matchId,
               text: msg.text,
               sender: { _id: socket.userId, name: socket.userName },
               createdAt: msg.createdAt,
               tempId,
            });

            if (!onlineUsers.has(otherId)) {
               const other = await User.findById(otherId).select("pushToken");
               if (
                  other?.pushToken?.startsWith("ExponentPushToken") &&
                  other.pushToken !== sender.pushToken // ← don't push if same device token
               ) {
                  fetch("https://exp.host/--/api/v2/push/send", {
                     method: "POST",
                     headers: { "Content-Type": "application/json" },
                     body: JSON.stringify({
                        to: other.pushToken,
                        title: socket.userName,
                        body: text.trim(),
                        sound: "default",
                     }),
                  }).catch(() => {});
               }
            }
            cb?.({ success: true, messageId: msg._id });
         } catch (err) {
            cb?.({ error: err.message });
         }
      });

      socket.on("typing:start", ({ matchId }) =>
         socket
            .to(`match:${matchId}`)
            .emit("typing:start", { matchId, userId: socket.userId }),
      );

      socket.on("typing:stop", ({ matchId }) =>
         socket
            .to(`match:${matchId}`)
            .emit("typing:stop", { matchId, userId: socket.userId }),
      );

      socket.on("messages:read", async ({ matchId }) => {
         await Message.updateMany(
            {
               matchId,
               sender: { $ne: socket.userId },
               "readBy.user": { $ne: socket.userId },
            },
            { $push: { readBy: { user: socket.userId, at: new Date() } } },
         ).catch(() => {});
         await Match.findByIdAndUpdate(matchId, {
            $set: { [`unreadCount.${socket.userId}`]: 0 },
         }).catch(() => {});
         socket
            .to(`match:${matchId}`)
            .emit("messages:read", { matchId, readBy: socket.userId });
      });

      socket.on("disconnect", () => {
         onlineUsers.delete(socket.userId);
         console.log(`🔴 ${socket.userName} disconnected`);
         socket.broadcast.emit("user:offline", { userId: socket.userId });
         User.findByIdAndUpdate(socket.userId, { lastSeen: new Date() }).catch(
            () => {},
         );
      });
   });

   return io;
};

module.exports = { initSocket, onlineUsers };
