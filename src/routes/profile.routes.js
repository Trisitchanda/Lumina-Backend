import { Router } from "express";
import { isLoggedIn } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/multar.middleware.js";

import {
  getMyProfile,
  updateProfile,
  updateNotifications,
  updatePayout,
  updateSecurity,
  requestPayout,
  updateAvatar,
  getExploreCreators,
  getPublicProfile
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
  "/change-avatar",
  isLoggedIn,
  upload.single("avatar"),
  updateAvatar
);

/* =========================
   PUBLIC
========================= */

// Explore Creators
profileRoutes.get("/explore", getExploreCreators);

// view other user's profile
profileRoutes.get("/:id", getPublicProfile);

export default profileRoutes;
