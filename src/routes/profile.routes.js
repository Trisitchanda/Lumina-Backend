import { Router } from "express";
import { isLoggedIn } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/multar.middleware.js";

import {
  getMyProfile,
  getPublicProfile,
  updateProfile,
  updateNotifications,
  updatePayout,
  updateSecurity,
  requestPayout,
  updateAvatar,
} from "../controllers/profile.controller.js";

const profileRoutes = Router();

/* =========================
   PRIVATE (ME)
========================= */

// fetchUserProfile
profileRoutes.get("/me", isLoggedIn, getMyProfile);

// updateProfile
profileRoutes.put("/updateprofile", isLoggedIn, updateProfile);

// updateNotifications
profileRoutes.put("/notifications", isLoggedIn, updateNotifications);

// updatePayout
profileRoutes.put("/payout", isLoggedIn, updatePayout);

// requestPayout
profileRoutes.post("/payout/request", isLoggedIn, requestPayout);

// updateSecurity
profileRoutes.put("/security", isLoggedIn, updateSecurity);

// updateAvatar
profileRoutes.put(
  "/avatar",
  isLoggedIn,
  upload.single("avatar"),
  updateAvatar
);

/* =========================
   PUBLIC
========================= */

// view other user's profile
profileRoutes.get("/:username", getPublicProfile);

export default profileRoutes;
