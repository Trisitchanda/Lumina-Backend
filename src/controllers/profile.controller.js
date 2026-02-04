import mongoose from "mongoose";
import User from "../models/user.models.js";
import { ApiError, ApiResponse } from "../utils/index.js";
import { uploadImageToCloud, deleteCloudFile } from "../utils/index.js";

const sanitizePrivateProfile = (user) => ({
  _id: user._id,
  role: user.role,
  displayName: user.displayName,
  username: user.username,
  email: user.email,
  bio: user.bio,
  website: user.website,
  twitter: user.twitter,
  instagram: user.instagram,
  location: user.location,
  avatar: user.avatar,
  notifications: user.notifications,
  payout: user.payout,
  security: user.security,
  earnings: user.earnings,
});

const sanitizePublicProfile = (user) => ({
  _id: user._id,
  displayName: user.displayName,
  username: user.username,
  bio: user.bio,
  website: user.website,
  twitter: user.twitter,
  instagram: user.instagram,
  location: user.location,
  avatar: user.avatar,
  category: user.category,
  followers: user.followers,
  following: user.following,
  createdAt: user.createdAt,
  role: user.role,
  earnings: {
    total: user.earnings?.total ?? 0,
  },
});


export const getExploreCreators = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Filters from Frontend
    const { search, category, sort } = req.query;

    // Only active Creators
    const query = {
      role: "creator",
      isActive: true
    };

    // Category Filter
    if (category && category !== "All") {
      query.category = category;
    }

    // Search Filter
    if (search) {
      query.$or = [
        { displayName: { $regex: search, $options: "i" } },
        { username: { $regex: search, $options: "i" } },
        { bio: { $regex: search, $options: "i" } },
      ];
    }

    // Sorting 
    let sortOptions = { createdAt: -1 }; // Default: Newest
    if (sort === "name") {
      sortOptions = { displayName: 1 }; // A-Z
    }
    // Note: Sorting by "popular" (followers count) requires Aggregation pipeline. 
    // For now, we fetch the data and let Frontend sort, or use default sorting.

    // Execute Query
    const creators = await User.find(query)
      .select("displayName username avatar bio coverImage category followers")
      .sort(sortOptions)
      .skip(skip)
      .limit(limit);

    // Get Total Count (for pagination UI)
    const total = await User.countDocuments(query);

    return res.status(200).json(
      new ApiResponse(200, "Creators fetched", {
        creators,
        total,
        page,
        hasMore: total > skip + creators.length,
      })
    );
  } catch (error) {
    next(error);
  }
};

/* =========================
   GET MY PROFILE
   (fetchUserProfile)
========================= */
export const getMyProfile = async (req, res, next) => {
  try {
    if (!req.user?._id) {
      throw new ApiError(401, "Unauthorized");
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        "Profile fetched successfully",
        sanitizePrivateProfile(user)
      )
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   GET PUBLIC USER PROFILE
   (by username or id)
========================= */
export const getPublicProfile = async (req, res, next) => {
  try {
    const identifier = req.params.username || req.params.id;

    if (!identifier) {
      throw new ApiError(400, "Invalid profile identifier");
    }

    let user;

    // Check if it's a valid MongoDB ID
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      user = await User.findById(identifier);
    }

    // If not found by ID (or it wasn't a valid ID), search by Username
    if (!user) {
      user = await User.findOne({ username: identifier });
    }

    // Final Validation
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    return res.status(200).json(
      new ApiResponse(
        200,
        "Public profile fetched successfully",
        sanitizePublicProfile(user)
      )
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   UPDATE PROFILE
   (updateProfile)
========================= */
export const updateProfile = async (req, res, next) => {
  try {
    const allowedFields = {
      displayName: "string",
      bio: "string",
      website: "string",
      twitter: "string",
      instagram: "string",
      location: "string",
      category: "string",
      role: "string"
    };
    const updates = {};

    for (const key in req.body) {
      if (!allowedFields[key]) continue;

      if (typeof req.body[key] !== allowedFields[key]) {
        throw new ApiError(400, `${key} must be a ${allowedFields[key]}`);
      }

      updates[key] = req.body[key].trim();
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "No valid fields provided");
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!user) throw new ApiError(404, "User not found");

    return res.status(200).json(
      new ApiResponse(
        200,
        "Profile updated successfully",
        sanitizePrivateProfile(user)
      )
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   UPDATE NOTIFICATIONS
   (updateNotifications)
========================= */
export const updateNotifications = async (req, res, next) => {
  try {
    if (typeof req.body !== "object") {
      throw new ApiError(400, "Invalid notification payload");
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { notifications: req.body } },
      { new: true, runValidators: true }
    );

    if (!user) throw new ApiError(404, "User not found");

    return res.status(200).json(
      new ApiResponse(
        200,
        "Notification settings updated",
        user.notifications
      )
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   UPDATE PAYOUT
   (updatePayout)
========================= */
export const updatePayout = async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      throw new ApiError(400, "Invalid payout payload");
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { payout: req.body } },
      { new: true, runValidators: true }
    );

    if (!user) throw new ApiError(404, "User not found");

    return res.status(200).json(
      new ApiResponse(200, "Payout details updated", user.payout)
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   UPDATE SECURITY
   (updateSecurity)
========================= */
export const updateSecurity = async (req, res, next) => {
  try {
    const { twoFactorEnabled } = req.body;

    if (typeof twoFactorEnabled !== "boolean") {
      throw new ApiError(400, "twoFactorEnabled must be boolean");
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { "security.twoFactorEnabled": twoFactorEnabled } },
      { new: true }
    );

    if (!user) throw new ApiError(404, "User not found");

    return res.status(200).json(
      new ApiResponse(200, "Security settings updated", user.security)
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   REQUEST PAYOUT
   (requestPayout)
========================= */
export const requestPayout = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw new ApiError(404, "User not found");

    if (user.earnings.available <= 0) {
      throw new ApiError(400, "No available balance for payout");
    }

    user.earnings.pending += user.earnings.available;
    user.earnings.available = 0;

    await user.save();

    return res.status(200).json(
      new ApiResponse(200, "Payout request submitted")
    );
  } catch (error) {
    next(error);
  }
};


/* =========================
   UPDATE AVATAR
   (updateAvatar)
========================= */
export const updateAvatar = async (req, res, next) => {
  try {
    if (!req.file?.path) {
      throw new ApiError(400, "Avatar file is required");
    }

    // const user = await User.findById(req.user._id);
    // if (!user) throw new ApiError(404, "User not found");

    const uploaded = await uploadImageToCloud(req.file.path);
    if (!uploaded?.secure_url || !uploaded?.public_id) {
      throw new ApiError(400, "Avatar upload failed");
    }

    if (req.user.avatar?.public_id) {
      await deleteCloudFile(req.user.avatar.public_id);
    }

    req.user.avatar = uploaded;
    await req.user.save();

    return res.status(200).json(
      new ApiResponse(200, "Avatar updated successfully", req.user.avatar)
    );
  } catch (error) {
    next(error);
  }
};

