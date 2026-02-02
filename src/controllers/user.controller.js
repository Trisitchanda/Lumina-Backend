import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/user.models.js";
import { ApiError, ApiResponse } from "../utils/index.js";
import constants from "../constants.js";
// import sendMail from "../utils/sendMail.js";
// import welcomeTemplate from "../emailTemplates/welcome.template.js";
// import forgotPasswordTemplate from "../emailTemplates/forgotPassword.template.js";
import { uploadImageToCloud, deleteCloudFile } from "../utils/index.js";

/* =========================
   REGISTER
========================= */
export const handleRegister = async (req, res, next) => {
  try {
    const { username, email, password, role } = req.body;
    const avatarFile = req.file;

    if (!username || !email || !password || !avatarFile) {
      throw new ApiError(400, "All fields are required");
    }

    // Email format validation using regex
    const emailRegex =
      /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

    if (!emailRegex.test(email)) {
      throw new ApiError(400, "Email Not Valid");
    }

    // Password validation in controller
    const passwordRegex =
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])[^\s]{8,64}$/;
    // check min 8 char, one uppercase, special char and number
    if (!passwordRegex.test(password)) {
      throw new ApiError(400, "Password Not Valid");
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      throw new ApiError(400, "User already exists");
    }

    const avatar = await uploadImageToCloud(avatarFile.path);
    if (!avatar?.secure_url) {
      throw new ApiError(400, "Avatar upload failed");
    }

    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password,
      role: role === "creator" ? "creator" : "user",
      avatar,
    });

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();

    // await sendMail(
    //   user.email,
    //   "Welcome to FanVault",
    //   welcomeTemplate({ name: user.username })
    // );

    user.password = undefined;
    user.refreshTokenHash = undefined;

    const safeUser = {
      _id: user._id,
      displayName: user.displayName,
      username: user.username,
      email: user.email,
      avatar: {
        public_id: user.avatar.public_id,
        secure_url: user.avatar.secure_url
      },
      role: user.role,
      bio: user.bio,
      website: user.website,
      twitter: user.twitter,
      instagram: user.instagram,
    };


    res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(201)
      .json(new ApiResponse(201, "Account created successfully", safeUser));
  } catch (error) {
    next(error);
  }
};

/* =========================
   LOGIN
========================= */
export const handleLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const user = await User.findOne({ email }).select("+password +refreshTokenHash");
    if (!user) {
      throw new ApiError(401, "Invalid credentials");
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new ApiError(401, "Invalid credentials");
    }

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await user.save();

    // user.password = undefined;
    // user.refreshTokenHash = undefined;

    const safeUser = {
      _id: user._id,
      displayName: user.displayName,
      username: user.username,
      email: user.email,
      avatar: {
        public_id: user.avatar.public_id,
        secure_url: user.avatar.secure_url
      },
      role: user.role,
      bio: user.bio,
      website: user.website,
      twitter: user.twitter,
      instagram: user.instagram,
    };

    res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 60 * 1000, // 1 hr
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000, //7 days
      })
      .status(200)
      .json(new ApiResponse(200, "Login successful", safeUser));
  } catch (error) {
    next(error);
  }
};

/* =========================
   LOGOUT
========================= */
export const handleLogout = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("+refreshTokenHash");
    user.refreshTokenHash = undefined;
    await user.save();

    res
      .clearCookie("accessToken", { httpOnly: true, secure: true, sameSite: "None" })
      .clearCookie("refreshToken", { httpOnly: true, secure: true, sameSite: "None" })
      .status(200)
      .json(new ApiResponse(200, "Logged out successfully"));
  } catch (error) {
    next(error);
  }
};

/* =========================
   GET PROFILE
========================= */
export const handleGetProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json(new ApiResponse(200, "Profile fetched", user));
  } catch (error) {
    next(error);
  }
};

/* =========================
   UPDATE PROFILE
========================= */
export const handleUpdateProfile = async (req, res, next) => {
  try {
    const updates = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.status(200).json(new ApiResponse(200, "Profile updated", user));
  } catch (error) {
    next(error);
  }
};

/* =========================
   CHANGE AVATAR
========================= */
export const handleChangeAvatar = async (req, res, next) => {
  try {
    const avatarFile = req.file;
    if (!avatarFile) throw new ApiError(400, "Avatar is required");

    const user = await User.findById(req.user._id);

    if (user.avatar?.public_id) {
      await deleteCloudFile(user.avatar.public_id);
    }

    const avatar = await uploadImageToCloud(avatarFile.path);
    user.avatar = avatar;
    await user.save();

    res.status(200).json(new ApiResponse(200, "Avatar updated", user.avatar));
  } catch (error) {
    next(error);
  }
};

/* =========================
   CHANGE PASSWORD
========================= */
export const handleChangePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select("+password");

    if (!(await user.comparePassword(oldPassword))) {
      throw new ApiError(401, "Incorrect current password");
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json(new ApiResponse(200, "Password changed successfully"));
  } catch (error) {
    next(error);
  }
};

/* =========================
   FORGOT PASSWORD
========================= */
export const handleForgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) throw new ApiError(404, "User not found");

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.forgotPasswordTokenHash = resetTokenHash;
    user.forgotPasswordExpiry = Date.now() + 15 * 60 * 1000;
    await user.save();

    const resetUrl = `${constants.FRONTEND_URL}/reset-password/${resetToken}`;

    // await sendMail(
    //   user.email,
    //   "Reset Password",
    //   forgotPasswordTemplate({ resetLink: resetUrl })
    // );

    res.status(200).json(new ApiResponse(200, "Reset link sent"));
  } catch (error) {
    next(error);
  }
};

/* =========================
   RESET PASSWORD
========================= */
export const handleResetPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      forgotPasswordTokenHash: tokenHash,
      forgotPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) throw new ApiError(400, "Token invalid or expired");

    user.password = password;
    user.forgotPasswordTokenHash = undefined;
    user.forgotPasswordExpiry = undefined;
    await user.save();

    res.status(200).json(new ApiResponse(200, "Password reset successful"));
  } catch (error) {
    next(error);
  }
};
