import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
    {
        // The user receiving the notification (The Inbox Owner)
        targetUserId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        // The user who triggered the action (e.g., the person who clicked 'like')
        triggerUser: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        // Used by your frontend switch statement to render the correct icon
        type: {
            type: String,
            enum: ['like', 'comment', 'follow', 'subscribe', 'purchase', 'mention'], 
            required: true,
        },
        // The human-readable text (e.g., "liked your post")
        message: {
            type: String,
            required: true,
        },
        // --- CRITICAL FOR UI UX ---
        // What did they interact with? If it's a 'like', what post? 
        // This allows you to wrap the notification in a <Link> on the frontend.
        targetEntityId: {
            type: Schema.Types.ObjectId,
            default: null, // Null for 'follow' notifications, populated for 'like'/'comment'
        },
        // Tells the frontend what route to use (e.g., /post/:id vs /collection/:id)
        targetEntityType: {
            type: String,
            enum: ['Post', 'Collection', 'Comment', 'Tier', 'User'],
            default: null,
        },
        // State management
        unread: {
            type: Boolean,
            default: true,
        }
    },
    { 
        timestamps: true 
    }
);

/* ========================================================================== */
/* DATABASE INDEXES (Do not skip these)                                       */
/* ========================================================================== */

// 1. Speeds up `Notification.find({ targetUserId: userId }).sort({ createdAt: -1 })`
// This is exactly what your feed controller queries.
notificationSchema.index({ targetUserId: 1, createdAt: -1 });

// 2. Speeds up `Notification.countDocuments({ targetUserId: userId, unread: true })`
// This prevents counting from slowing down your dashboard load times.
notificationSchema.index({ targetUserId: 1, unread: 1 });

export const Notification = mongoose.model("Notification", notificationSchema);