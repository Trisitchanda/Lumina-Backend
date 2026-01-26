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
  avatar: user.avatar,
  notifications: user.notifications,
  payout: user.payout,
  security: user.security,
  earnings: user.earnings,
});

const sanitizePublicProfile = (user) => ({
  displayName: user.displayName,
  username: user.username,
  bio: user.bio,
  website: user.website,
  twitter: user.twitter,
  instagram: user.instagram,
  avatar: user.avatar,
  earnings: {
    total: user.earnings?.total ?? 0,
  },
});


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
    const { username } = req.params;

    if (!username || typeof username !== "string") {
      throw new ApiError(400, "Invalid username");
    }

    const user = await User.findOne({ username });
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        "Public profile fetched",
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

