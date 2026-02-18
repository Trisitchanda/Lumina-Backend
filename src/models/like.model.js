import mongoose from "mongoose";

const likeSchema = new mongoose.Schema({
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'targetType' // Dynamic ref so like Posts AND Comments
  },
  targetType: {
    type: String,
    enum: ['Post', 'Comment'],
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  }
}, { timestamps: true });

// COMPOUND INDEX
// This ensures a user can only like a specific post ONCE.
likeSchema.index({ targetId: 1, userId: 1 }, { unique: true });

export const Like = mongoose.model("Like", likeSchema);