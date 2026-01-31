import mongoose from "mongoose";

const postSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, 
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    content: {
      type: String, 
      default: "",
    },
    media: [
      {
        public_id: String,
        secure_url: String,
        type: { type: String, enum: ["image", "video", "audio"] },
      },
    ],
    coverImage: {
      public_id: String,
      secure_url: String,
    },
    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "poll"],
      default: "text",
    },
    isPaid: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      default: 0,
    },
    isMembersOnly: {
      type: Boolean,
      default: false,
    },
    allowedTiers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tier",
    }],
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    isDraft: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Post = mongoose.model("Post", postSchema);