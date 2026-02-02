import mongoose from "mongoose";

const collectionSchema = new mongoose.Schema(
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
    },
    description: {
      type: String,
      maxlength: 500,
    },
    coverImage: {
      public_id: String,
      secure_url: String,
    },
    posts: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    }],
    isPaid: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    isDraft: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Collection = mongoose.model("Collection", collectionSchema);