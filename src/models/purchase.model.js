import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    creatorId: { // easily calculate creator earnings later
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    
    // POLYMORPHIC ASSOCIATION allows the purchase to be a Post, a Collection, or a Product
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'targetType' 
    },
    targetType: {
      type: String,
      required: true,
      enum: ['Post', 'Collection', 'Tier', 'Product'] 
    },

    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: "INR" 
    },
    
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
      index: true
    },
    
    paymentId: { type: String }, // The Stripe/Razorpay Payment Intent ID
    paymentProvider: { type: String, enum: ["stripe", "razorpay"] },
    
    receiptUrl: { type: String } // URL to the invoice/receipt
  },
  { timestamps: true }
);

// "Did User X buy Post Y successfully?"
purchaseSchema.index({ userId: 1, targetId: 1, status: 1 });

export const Purchase = mongoose.model("Purchase", purchaseSchema);