import mongoose from "mongoose";

const commentSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true,
    trim: true
  },
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Post",
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  // For nested replies
  parentCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Comment",
    default: null
  },
  likesCount: { type: Number, default: 0 }
}, { timestamps: true });

export const Comment = mongoose.model("Comment", commentSchema);