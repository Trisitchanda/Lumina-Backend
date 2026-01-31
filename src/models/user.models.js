import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import constants from "../constants.js";

const userSchema = new mongoose.Schema(
  {
    /* ===================== IDENTITY ===================== */
    displayName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: "",
    },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: [/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and _"],
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },

    role: {
      type: String,
      enum: ["user", "creator"],
      default: "user",
    },

    /* ===================== PROFILE ===================== */
    bio: {
      type: String,
      maxlength: 500,
      default: "",
    },

    location: {
      type: String,
      maxlength: 50,
      default: "Earth",
    },

    website: {
      type: String,
      trim: true,
      default: "",
    },

    twitter: {
      type: String,
      trim: true,
      default: "",
    },

    instagram: {
      type: String,
      trim: true,
      default: "",
    },

    avatar: {
      public_id: {
        type: String,
      },
      secure_url: {
        type: String,
        required: [true, "Avatar is required"],
      },
    },

    category: {
      type: String,
      enum: [
        "Art & Illustration",
        "Music Production",
        "Technology",
        "Fitness & Health",
        "Photography",
        "Game Development",
        "Writing",
        "Other"
      ],
      default: "Other",
      index: true, // IMPORTANT: Makes filtering by category fast
    },

    /* ===================== INTERACTIONS & LIBRARY ===================== */
    // Tracking relationships for quick access
    following: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    followers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    likedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post",
      },
    ],

    savedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post",
      },
    ],

    // Quick lookup for purchased content to unlock it efficiently
    purchasedPosts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Post",
      },
    ],

    purchasedCollections: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Collection",
      },
    ],

    /* ===================== NOTIFICATIONS ===================== */
    notifications: {
      emailNewFollower: { type: Boolean, default: false },
      emailNewSubscriber: { type: Boolean, default: false },
      emailNewComment: { type: Boolean, default: false },
      emailNewPurchase: { type: Boolean, default: false },
      emailWeeklyDigest: { type: Boolean, default: false },

      pushNewFollower: { type: Boolean, default: false },
      pushNewSubscriber: { type: Boolean, default: false },
      pushNewComment: { type: Boolean, default: false },
      pushNewPurchase: { type: Boolean, default: false },

      marketingEmails: { type: Boolean, default: false },
    },

    /* ===================== PAYOUT ===================== */
    payout: {
      payoutMethod: {
        type: String,
        enum: ["bank", "paypal", "stripe"],
        default: "bank",
      },

      bankName: {
        type: String,
        default: "",
      },

      accountNumber: {
        type: String,
        select: false, // 🔐 sensitive
        default: "",
      },

      routingNumber: {
        type: String,
        select: false, // 🔐 sensitive
        default: "",
      },

      paypalEmail: {
        type: String,
        default: "",
      },

      minimumPayout: {
        type: String,
        default: "0",
      },

      payoutSchedule: {
        type: String,
        enum: ["weekly", "biweekly", "monthly"],
        default: "monthly",
      },
    },

    /* ===================== SECURITY ===================== */
    security: {
      twoFactorEnabled: {
        type: Boolean,
        default: false,
      },
      lastLogin: {
        type: Date,
        default: null,
      },
    },

    /* ===================== EARNINGS ===================== */
    earnings: {
      available: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    /* ===================== AUTH INTERNALS ===================== */
    refreshTokenHash: {
      type: String,
      select: false,
    },

    forgotPasswordTokenHash: {
      type: String,
      select: false,
    },

    forgotPasswordExpiry: {
      type: Date,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

//
// 🔐 PASSWORD HASHING
//
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

//
// 🔐 INSTANCE METHODS
//
userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      role: this.role,
      username: this.username,
    },
    constants.ACCESS_TOKEN_SECRET,
    {
      expiresIn: constants.ACCESS_TOKEN_EXPIRY,
    }
  );
};

userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
    },
    constants.REFRESH_TOKEN_SECRET,
    {
      expiresIn: constants.REFRESH_TOKEN_EXPIRY,
    }
  );
};
const User = mongoose.model("User", userSchema);
export default User;
