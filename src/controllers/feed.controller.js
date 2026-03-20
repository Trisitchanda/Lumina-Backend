import { Post } from "../models/post.model.js";
import { Like } from "../models/like.model.js";
import { SavedPost } from "../models/savepost.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Purchase } from "../models/purchase.model.js";
import User from "../models/user.models.js";
import { Notification } from "../models/notification.model.js"
import { ApiError, ApiResponse } from "../utils/index.js";
import { v2 as cloudinary } from 'cloudinary';

/* ========================================================================== */
/* HELPERS (Kept here for data injection)                                     */
/* ========================================================================== */

const injectInteractionStatus = async (posts, userId) => {
    if (!userId || posts.length === 0) {
        return posts.map(post => ({ ...post, isLiked: false, isSaved: false }));
    }

    const postIds = posts.map(p => p._id);

    const [likes, saves] = await Promise.all([
        Like.find({ userId: userId, targetId: { $in: postIds }, targetType: "Post" }).select("targetId").lean(),
        SavedPost.find({ user: userId, post: { $in: postIds } }).select("post").lean()
    ]);

    const likedSet = new Set(likes.map(l => l.targetId.toString()));
    const savedSet = new Set(saves.map(s => s.post.toString()));

    return posts.map(post => ({
        ...post,
        isLiked: likedSet.has(post._id.toString()),
        isSaved: savedSet.has(post._id.toString())
    }));
};

const injectAccessStatus = async (posts, userId) => {
    if (posts.length === 0) return posts;

    if (!userId) {
        return posts.map(post => ({ ...post, hasAccess: !post.isPaid && !post.isMembersOnly }));
    }

    const postIds = posts.map(p => p._id);
    const creatorIds = [...new Set(posts.map(p => p.creatorId?._id ? p.creatorId._id.toString() : p.creatorId.toString()))];

    const purchases = await Purchase.find({
        userId: userId, targetId: { $in: postIds }, targetType: 'Post', status: 'completed'
    }).select('targetId').lean();

    const purchasedSet = new Set(purchases.map(p => p.targetId.toString()));

    const subscriptions = await Subscription.find({
        subscriberId: userId, creatorId: { $in: creatorIds }, status: 'active', currentPeriodEnd: { $gt: new Date() }
    }).select('creatorId tierId').lean();

    const subsMap = {};
    subscriptions.forEach(sub => {
        const cId = sub.creatorId.toString();
        if (!subsMap[cId]) subsMap[cId] = new Set();
        subsMap[cId].add(sub.tierId.toString());
    });

    return posts.map(post => {
        const cId = post.creatorId?._id ? post.creatorId._id.toString() : post.creatorId.toString();
        let hasAccess = false;

        if (cId === userId.toString()) hasAccess = true;
        else if (!post.isPaid && !post.isMembersOnly) hasAccess = true;
        else if (post.isPaid && purchasedSet.has(post._id.toString())) hasAccess = true;
        else if (post.isMembersOnly && subsMap[cId] && post.allowedTiers) {
            const userTiers = subsMap[cId];
            if (post.allowedTiers.some(tid => userTiers.has(tid.toString()))) hasAccess = true;
        }

        return { ...post, hasAccess };
    });
};

/* ========================================================================== */
/* DYNAMIC FEED CONTROLLER                                                    */
/* ========================================================================== */

export const getFeed = async (req, res, next) => {
    try {
        const type = req.query.type || 'home'; 
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const userId = req.user?._id;

        let query = { isDraft: false };
        let sortQuery = { createdAt: -1 }; 

        // 1. Build the Database Query based on the requested Tab
        if (type === 'home') {
            if (!userId) {
                query = { isDraft: false }; 
            } else {
                const user = await User.findById(userId).select("following").lean();
                
                // FIX 1: Safeguard against deleted users with valid tokens
                if (!user) {
                    return res.status(401).json(new ApiResponse(401, "User not found"));
                }

                if (user.following && user.following.length > 0) {
                    query.creatorId = { $in: user.following };
                } else {
                    return res.status(200).json(new ApiResponse(200, "Feed fetched", { posts: [], page, hasMore: false }));
                }
            }
        } else if (type === 'popular') {
            sortQuery = { likesCount: -1, createdAt: -1 };
        } else if (type === 'foryou') {
            query = { isDraft: false };
        }

        // 2. Execute Query
        const rawPosts = await Post.find(query)
            .sort(sortQuery)
            .skip(skip)
            .limit(limit)
            .populate("creatorId", "displayName username avatar isVerified")
            .lean();

        // FIX 2: THE ORPHAN SANITIZER (Prevents 500 crashes)
        // If the creator was deleted from the DB, populate returns null. We must strip these out.
        const sanitizedPosts = rawPosts.filter(post => post.creatorId !== null);

        // 3. Check if there is more data for infinite scroll
        const totalPosts = await Post.countDocuments(query);
        // Compare against 'limit' instead of array length to account for filtered orphans
        const hasMore = totalPosts > skip + limit; 

        // Early exit if the page is completely empty
        if (sanitizedPosts.length === 0) {
             return res.status(200).json(
                new ApiResponse(200, "Feed fetched successfully", { posts: [], page, hasMore, feedType: type })
            );
        }

        // 4. Inject Statuses (Now perfectly safe because orphaned posts are gone)
        let processedPosts = await injectInteractionStatus(sanitizedPosts, userId);
        processedPosts = await injectAccessStatus(processedPosts, userId);

        // 5. Secure locked content
        const securedPosts = processedPosts.map(post => {
            if (!post.hasAccess) {
                let secureBlurredImage = null;
                // Added optional chaining here just to be bulletproof
                if (post.coverImage?.public_id) {
                    const blurredUrl = cloudinary.url(post.coverImage.public_id, {
                        secure: true, effect: "blur:2000", quality: 10, sign_url: true
                    });
                    secureBlurredImage = { public_id: post.coverImage.public_id, secure_url: blurredUrl };
                } else {
                    secureBlurredImage = post.coverImage; 
                }

                return {
                    ...post,
                    coverImage: secureBlurredImage,
                    media: [], 
                    content: post.content ? post.content.substring(0, 100) + "..." : "", 
                    isLocked: true
                };
            }
            return post;
        });

        return res.status(200).json(
            new ApiResponse(200, "Feed fetched successfully", {
                posts: securedPosts,
                page,
                hasMore,
                feedType: type
            })
        );
    } catch (error) {
        // PRO-TIP: Log the error to the console here so you don't have to guess next time!
        console.error(`[getFeed Error] Tab: ${req.query.type}, Page: ${req.query.page} ->`, error);
        next(error);
    }
};

/* ========================================================================== */
/* SIDEBAR & DISCOVERY                                                        */
/* ========================================================================== */

export const getSuggestedCreators = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 3;
        const userId = req.user?._id;

        let query = { role: "creator" }; // Assuming you have a role system. Adjust if not.

        if (userId) {
            const user = await User.findById(userId).select("following").lean();
            // Don't suggest users they already follow, and don't suggest themselves
            const excludedIds = user.following ? [...user.following, userId] : [userId];
            query._id = { $nin: excludedIds };
        }

        // Fetch random creators or highest followed creators
        const suggested = await User.find(query)
            .select("displayName username avatar")
            .limit(limit)
            .lean();

        return res.status(200).json(
            new ApiResponse(200, "Suggested creators fetched", suggested)
        );
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* INBOX / NOTIFICATIONS                                                      */
/* ========================================================================== */

/* ========================================================================== */
/* INBOX / NOTIFICATIONS                                                      */
/* ========================================================================== */

export const getNotifications = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // Querying targetUserId exactly as your schema and indexes require
        const notifications = await Notification.find({ targetUserId: userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("triggerUser", "displayName username avatar")
            .lean();

        const totalNotifs = await Notification.countDocuments({ targetUserId: userId });
        const unreadCount = await Notification.countDocuments({ targetUserId: userId, unread: true });
        const hasMore = totalNotifs > skip + limit;

        return res.status(200).json(
            new ApiResponse(200, "Notifications fetched", {
                notifications,
                unreadCount,
                page,
                hasMore
            })
        );
    } catch (error) {
        next(error);
    }
};

export const markNotificationAsRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        await Notification.findOneAndUpdate(
            { _id: id, targetUserId: userId },
            { $set: { unread: false } }
        );

        return res.status(200).json(new ApiResponse(200, "Notification marked as read"));
    } catch (error) {
        next(error);
    }
};

export const markAllNotificationsAsRead = async (req, res, next) => {
    try {
        const userId = req.user._id;

        // updateMany is much more efficient than looping through IDs
        const result = await Notification.updateMany(
            { 
                targetUserId: userId, 
                unread: true // Only target the ones that actually need changing
            },
            { $set: { unread: false } }
        );

        // Result will tell you how many were actually modified
        return res.status(200).json(
            new ApiResponse(
                200, 
                `${result.modifiedCount} notifications marked as read`,
                { modifiedCount: result.modifiedCount }
            )
        );
    } catch (error) {
        next(error);
    }
};