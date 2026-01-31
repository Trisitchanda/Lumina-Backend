import mongoose from "mongoose";

const tierSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true, 
    },
    price: {
      type: Number,
      required: true, 
    },
    benefits: [{
      type: String, 
    }],
    coverImage: {
        public_id: String,
        secure_url: String,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    }
  },
  { timestamps: true }
);

export const Tier = mongoose.model("Tier", tierSchema);