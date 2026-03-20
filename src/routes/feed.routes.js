import { Router } from "express";
import { isLoggedIn, optionalAuth } from "../middlewares/auth.middleware.js";
// IMPORTANT: You need to create this middleware if you haven't already! 
// It should attach req.user if a token exists, but NOT throw an error if missing.

import {
   getFeed,
   getSuggestedCreators,
   getNotifications,
   markAllNotificationsAsRead,
   markNotificationAsRead
} from "../controllers/feed.controller.js";

const feedRoutes = Router();

/* =========================
   MIXED ACCESS (Public & Private)
   Uses optionalAuth so guests can still see "Popular" and "For You"
========================= */

// Get Dynamic Feed (?type=home|foryou|popular & page=1)
feedRoutes.get("/", optionalAuth, getFeed);

// Get Suggested Creators (Excludes already followed users if logged in)
feedRoutes.get("/suggested", optionalAuth, getSuggestedCreators);

/* =========================
   PRIVATE (Inbox Owner Only)
   Uses strict isLoggedIn middleware
========================= */

// Get user notifications
feedRoutes.get("/notifications", isLoggedIn, getNotifications);

// Mark all notification as read
feedRoutes.put("/notifications/:id/read", isLoggedIn, markAllNotificationsAsRead);

export default feedRoutes;