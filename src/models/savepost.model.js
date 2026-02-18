import mongoose from "mongoose";

const savedPostSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true 
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    required: true
  },
}, { timestamps: true });

// a user can't save the same post twice
savedPostSchema.index({ user: 1, post: 1 }, { unique: true });

export const SavedPost = mongoose.model("SavedPost", savedPostSchema);