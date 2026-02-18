import mongoose from "mongoose";

// 1Sub-schemas for cleaner code and reusability
const mediaSchema = new mongoose.Schema({
  public_id: { type: String, required: true },
  secure_url: { type: String, required: true },
  type: { 
    type: String, 
    enum: ["image", "video", "audio"], 
    required: true 
  }
}, { _id: false }); // Disable _id for media items to save space if not needed individually

const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  votes: { type: Number, default: 0 } 
}); // to identify WHICH option a user clicked.

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
      trim: true
    },
    media: [mediaSchema],
    
    coverImage: {
      public_id: String,
      secure_url: String,
    },
    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "poll"],
      default: "text",
      index: true //filter "Show me only videos"
    },
    pollOptions: [pollOptionSchema],
    
    isPaid: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      default: 0,
      min: 0 // No negative prices
    },
    isMembersOnly: {
      type: Boolean,
      default: false,
    },
    allowedTiers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tier",
    }],
    
    // Denormalized Counts 
    likesCount: { type: Number, default: 0, min: 0 },
    commentsCount: { type: Number, default: 0, min: 0 },
    
    isDraft: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Most common query: "Get posts by this user, most recent first"
postSchema.index({ creatorId: 1, createdAt: -1 });

export const Post = mongoose.model("Post", postSchema);