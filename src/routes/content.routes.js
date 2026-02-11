import { Router } from "express";
import { isLoggedIn } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/multar.middleware.js";

import {
  getFeed,
  createPost,
  updatePost,
  deletePost,
  getCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  toggleLike,
  toggleFollow,
  subscribeToCreator,
  unsubscribeFromCreator,
  purchaseItem,
  getFollowingList,
  getMyPosts,
  getCreatorPosts
} from "../controllers/content.controller.js";

const contentRoutes = Router();

/* ========================================================================== */
/* FEED & DISCOVERY                                                           */
/* ========================================================================== */

// Get the main feed (with pagination)
contentRoutes.get("/feed", isLoggedIn, getFeed);


/* ========================================================================== */
/* POSTS CRUD                                                                 */
/* ========================================================================== */

// Create a new post (handles image upload)
contentRoutes.post(
  "/posts", 
  isLoggedIn, 
  upload.fields([
    { name: "image", maxCount: 1 }, 
    { name: "audio", maxCount: 1 }, 
  ]),
  createPost
);

// Update a post
contentRoutes.put(
  "/posts/:id", 
  isLoggedIn, 
  upload.single("coverImage"), 
  updatePost
);

// Delete a post
contentRoutes.delete("/posts/:id", isLoggedIn, deletePost);

// fetch post
contentRoutes.get("/posts/me", isLoggedIn, getMyPosts);

//fetch creator post
contentRoutes.get("/posts/:creatorId", isLoggedIn, getCreatorPosts);


/* ========================================================================== */
/* COLLECTIONS CRUD                                                           */
/* ========================================================================== */

// Get MY collections (No ID param)
contentRoutes.get("/collections", isLoggedIn, getCollections);

// Get CREATOR'S collections (With ID param)
contentRoutes.get("/collections/:creatorId", isLoggedIn, getCollections);

// Create a collection
contentRoutes.post(
  "/collections", 
  isLoggedIn, 
  upload.single("coverImage"), 
  createCollection
);

// Update a collection
contentRoutes.put("/collections/:id", isLoggedIn, updateCollection);

// Delete a collection
contentRoutes.delete("/collections/:id", isLoggedIn, deleteCollection);


/* ========================================================================== */
/* TIERS CRUD                                                                 */
/* ========================================================================== */

// Get MY tiers
contentRoutes.get("/tiers", isLoggedIn, getTiers);

// Get CREATOR'S tiers
contentRoutes.get("/tiers/:creatorId", isLoggedIn, getTiers);

// Create a tier
contentRoutes.post("/tiers", isLoggedIn, createTier);

// Update a tier
contentRoutes.put("/tiers/:id", isLoggedIn, updateTier);

// Delete a tier
contentRoutes.delete("/tiers/:id", isLoggedIn, deleteTier);


/* ========================================================================== */
/* INTERACTIONS                                                               */
/* ========================================================================== */

// Toggle Like on a Post
contentRoutes.post("/posts/:id/like", isLoggedIn, toggleLike);

// Toggle Follow on a User
contentRoutes.post("/users/:id/follow", isLoggedIn, toggleFollow);

// Get following list
contentRoutes.get("/following", isLoggedIn, getFollowingList);

/* ========================================================================== */
/* COMMERCE & SUBSCRIPTIONS                                                   */
/* ========================================================================== */

// Purchase a Post or Collection (One-time)
contentRoutes.post("/purchase", isLoggedIn, purchaseItem);

// Subscribe to a Creator's Tier
contentRoutes.post("/subscribe", isLoggedIn, subscribeToCreator);

// Unsubscribe from a Creator
contentRoutes.post("/unsubscribe", isLoggedIn, unsubscribeFromCreator);

export default contentRoutes;