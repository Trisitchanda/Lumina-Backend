import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/user.models.js";
import { ApiError } from "../utils/index.js";
import constants from "../constants.js";

/**
 * 🔁 Refresh Access Token
 */
const refreshAccessToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new ApiError(455, "Session expired. Please login again");
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(
        refreshToken,
        constants.REFRESH_TOKEN_SECRET
      );
    } catch {
      throw new ApiError(455, "Invalid or expired refresh token");
    }

    const user = await User.findById(decoded._id).select("+refreshTokenHash");
    if (!user) {
      throw new ApiError(455, "User not found");
    }

    // Compare hashed refresh token
    const isValid = await bcrypt.compare(
      refreshToken,
      user.refreshTokenHash
    );

    if (!isValid) {
      throw new ApiError(455, "Invalid or expired refresh token");
    }

    // Generate new tokens
    const newAccessToken = user.generateAccessToken();
    const newRefreshToken = user.generateRefreshToken();

    // Hash and store refresh token
    user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    await user.save();

    // Attach user
    req.user = user;

    // Set cookies
    res
      .cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      })
      .cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * 🔐 Check if user is logged in
 */
export const isLoggedIn = async (req, res, next) => {
  try {
    const accessToken = req.cookies?.accessToken;

    // if (!accessToken) {
    //   throw new ApiError(455, "Not authenticated");
    // }

    try {
      const decoded = jwt.verify(
        accessToken,
        constants.ACCESS_TOKEN_SECRET
      );

      const user = await User.findById(decoded._id);
      if (!user || !user.isActive) {
        throw new ApiError(455, "User not found or inactive");
      }

      req.user = user;
      next();
    } catch {
      // Access token expired → try refresh
      await refreshAccessToken(req, res, next);
    }
  } catch (error) {
    next(error);
  }
};

/**
 * 🛂 Role-based authorization
 */
export const isAuthorized =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new ApiError(403, "You are not authorized to access this resource")
      );
    }
    next();
  };
