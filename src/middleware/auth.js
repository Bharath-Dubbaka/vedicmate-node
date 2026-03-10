const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
   try {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer "))
         return res.status(401).json({ success: false, message: "No token" });

      const token = auth.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select(
         "-likedUsers -passedUsers",
      );
      if (!user)
         return res
            .status(401)
            .json({ success: false, message: "User not found" });

      user.lastSeen = new Date();
      await user.save({ validateBeforeSave: false });
      req.user = user;
      next();
   } catch {
      return res.status(401).json({ success: false, message: "Invalid token" });
   }
};

module.exports = { protect };
