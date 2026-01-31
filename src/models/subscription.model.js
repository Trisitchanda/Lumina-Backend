import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    subscriberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, 
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, 
    },
    tierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tier",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "expired"],
      default: "active",
    },
    startDate: { type: Date, default: Date.now },
    nextBillingDate: { type: Date },
    paymentSubscriptionId: { type: String }, 
  },
  { timestamps: true }
);

subscriptionSchema.index({ subscriberId: 1, creatorId: 1 }, { unique: true });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);