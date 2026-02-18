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
      enum: ["active", "past_due", "cancelled", "expired"],
      default: "active",
      index: true // "Find all active subs"
    },
    currentPeriodStart: { type: Date, default: Date.now },
    currentPeriodEnd: { type: Date, required: true }, // The "Access Valid Until" date
    cancelAtPeriodEnd: { type: Boolean, default: false }, // True if user cancelled but paid time remains
    
    paymentSubscriptionId: { type: String }, // Stripe/Razorpay Subscription ID
    paymentProvider: { type: String, enum: ["stripe", "razorpay"], default: "stripe" }
  },
  { timestamps: true }
);
 
// COMPOUND INDEX:: "Does User X have an active sub to Creator Y?"
subscriptionSchema.index({ subscriberId: 1, creatorId: 1, status: 1 });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);