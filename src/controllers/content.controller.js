import { Post } from "../models/post.model.js";
import { Collection } from "../models/collection.model.js";
import { Tier } from "../models/tier.model.js";
import { Subscription } from "../models/subscription.model.js";
import User from "../models/user.models.js";
import { ApiError, ApiResponse, uploadImageToCloud } from "../utils/index.js";

/* ========================================================================== */
/* FEED                                                                       */
/* ========================================================================== */

export const getFeed = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // 1. Fetch Posts (Sorted by newest)
        const posts = await Post.find({ isDraft: false })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("creatorId", "displayName username avatar role");

        // 2. Check if more posts exist
        const totalPosts = await Post.countDocuments({ isDraft: false });
        const hasMore = totalPosts > skip + posts.length;

        // 3. Get User Interactions (Optimized)
        // We send back the IDs of things the user has liked/saved so the UI can show the correct icon state (filled vs outlined)
        const user = await User.findById(req.user._id).select("likedPosts savedPosts following");

        return res.status(200).json(
            new ApiResponse(200, "Feed fetched", {
                posts,
                page,
                hasMore,
                likedPostIds: user?.likedPosts || [],
                savedPostIds: user?.savedPosts || [],
                followedCreatorIds: user?.following || [],
            })
        );
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* POSTS CRUD                                                                 */
/* ========================================================================== */

export const createPost = async (req, res, next) => {
    try {
        const { title, content, type, isPaid, price, isMembersOnly, allowedTiers } = req.body;

        // Validation: Paid content logic
        const priceNum = Number(price);
        const isPaidBool = isPaid === "true" || isPaid === true;
        if (isPaidBool && (isNaN(priceNum) || priceNum < 0)) {
            throw new ApiError(400, "Invalid price for paid content");
        }

        let coverImage = null;
        if (req.file) {
            const uploaded = await uploadImageToCloud(req.file.path);
            if (!uploaded) throw new ApiError(500, "Image upload failed");
            coverImage = { public_id: uploaded.public_id, secure_url: uploaded.secure_url };
        }

        const post = await Post.create({
            creatorId: req.user._id,
            title: title?.trim(),
            content: content?.trim(),
            type: type || "text",
            isPaid: isPaidBool,
            price: priceNum || 0,
            isMembersOnly: isMembersOnly === "true" || isMembersOnly === true,
            allowedTiers: allowedTiers ? JSON.parse(allowedTiers) : [], // Handle FormData array parsing
            coverImage,
        });

        await post.populate("creatorId", "displayName username avatar");

        return res.status(201).json(new ApiResponse(201, "Post created", post));
    } catch (error) {
        next(error);
    }
};

export const updatePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Ensure user owns the post
        const post = await Post.findOne({ _id: id, creatorId: req.user._id });
        if (!post) throw new ApiError(404, "Post not found or unauthorized");

        // Handle Image Update if new file provided
        if (req.file) {
            const uploaded = await uploadImageToCloud(req.file.path);
            updates.coverImage = { public_id: uploaded.public_id, secure_url: uploaded.secure_url };
        }

        const updatedPost = await Post.findByIdAndUpdate(id, updates, { new: true }).populate("creatorId", "displayName username avatar");

        return res.status(200).json(new ApiResponse(200, "Post updated", updatedPost));
    } catch (error) {
        next(error);
    }
};

export const deletePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const post = await Post.findOneAndDelete({ _id: id, creatorId: req.user._id });

        if (!post) throw new ApiError(404, "Post not found or unauthorized");

        return res.status(200).json(new ApiResponse(200, "Post deleted"));
    } catch (error) {
        next(error);
    }
};

/* =========================
   GET MY POSTS (Dashboard)
========================= */
export const getMyPosts = async (req, res, next) => {
    try {
        const posts = await Post.find({ creatorId: req.user._id })
            .sort({ createdAt: -1 }) // Newest first
            .populate("creatorId", "displayName username avatar");

        return res.status(200).json(new ApiResponse(200, "My posts fetched", posts));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* GET CREATOR POSTS (Public)                                            */
/* ========================================================================== */
export const getCreatorPosts = async (req, res, next) => {
    try {
        const { creatorId } = req.params;

        const posts = await Post.find({
            creatorId: creatorId,
            isDraft: false // ✅ Only show published posts
        })
            .sort({ createdAt: -1 })
            .populate("creatorId", "displayName username avatar");

        return res.status(200).json(new ApiResponse(200, "Creator posts fetched", posts));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* COLLECTIONS CRUD                                                           */
/* ========================================================================== */

export const getCollections = async (req, res, next) => {
    try {
        const { creatorId } = req.params;
        // If no creatorId passed, get my own collections
        const targetId = creatorId || req.user._id;

        const collections = await Collection.find({ creatorId: targetId }).sort({ createdAt: -1 });
        return res.status(200).json(new ApiResponse(200, "Collections fetched", collections));
    } catch (error) {
        next(error);
    }
};

export const createCollection = async (req, res, next) => {
    try {
        const { title, description, postIds, isPaid, price } = req.body;

        const count = await Post.countDocuments({ _id: { $in: postIds || [] }, creatorId: req.user._id });
        if (postIds && postIds.length !== count) throw new ApiError(403, "You can only add your own posts");

        const collection = await Collection.create({
            creatorId: req.user._id,
            title,
            description,
            posts: postIds || [], // Array of Post IDs
            isPaid: isPaid === "true" || isPaid === true,
            price: Number(price) || 0,
        });

        return res.status(201).json(new ApiResponse(201, "Collection created", collection));
    } catch (error) {
        next(error);
    }
};

export const updateCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const collection = await Collection.findOneAndUpdate(
            { _id: id, creatorId: req.user._id },
            req.body,
            { new: true }
        );

        if (!collection) throw new ApiError(404, "Collection not found");

        return res.status(200).json(new ApiResponse(200, "Collection updated", collection));
    } catch (error) {
        next(error);
    }
};

export const deleteCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const collection = await Collection.findOneAndDelete({ _id: id, creatorId: req.user._id });

        if (!collection) throw new ApiError(404, "Collection not found");

        return res.status(200).json(new ApiResponse(200, "Collection deleted"));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* TIERS CRUD                                                                 */
/* ========================================================================== */

export const getTiers = async (req, res, next) => {
    try {
        const { creatorId } = req.params;
        // Default to requesting user if not specified (for editing mode)
        const targetId = creatorId || req.user._id;

        const query = { creatorId: targetId };
        if (req.params.creatorId) {
            query.isActive = true;
        }

        const tiers = await Tier.find({ creatorId: targetId, isActive: true });
        return res.status(200).json(new ApiResponse(200, "Tiers fetched", tiers));
    } catch (error) {
        next(error);
    }
};

export const createTier = async (req, res, next) => {
    try {
        const { name, price, benefits, isPopular } = req.body;

        const tier = await Tier.create({
            creatorId: req.user._id,
            name,
            price: Number(price),
            benefits,
            isPopular: isPopular === "true" || isPopular === true,
        });

        return res.status(201).json(new ApiResponse(201, "Tier created", tier));
    } catch (error) {
        next(error);
    }
};

export const updateTier = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tier = await Tier.findOneAndUpdate(
            { _id: id, creatorId: req.user._id },
            req.body,
            { new: true }
        );
        if (!tier) throw new ApiError(404, "Tier not found");
        return res.status(200).json(new ApiResponse(200, "Tier updated", tier));
    } catch (error) {
        next(error);
    }
};

export const deleteTier = async (req, res, next) => {
    try {
        // Prevent delete if active subscriptions exist
        const activeSubs = await Subscription.exists({ tierId: req.params.id, status: "active" });
        if (activeSubs) throw new ApiError(400, "Cannot delete tier with active subscribers. Archive it instead.");

        const tier = await Tier.findOneAndDelete({ _id: req.params.id, creatorId: req.user._id });
        if (!tier) throw new ApiError(404, "Tier not found");
        return res.status(200).json(new ApiResponse(200, "Tier deleted"));
    } catch (error) { next(error); }
};

/* ========================================================================== */
/* INTERACTIONS (Like, Save, Follow)                                          */
/* ========================================================================== */

export const toggleLike = async (req, res, next) => {
    try {
        const { id: postId } = req.params;
        const userId = req.user._id;

        const post = await Post.findById(postId);
        if (!post) throw new ApiError(404, "Post not found");

        const user = await User.findById(userId);

        // Check if already liked
        const isLiked = user.likedPosts.includes(postId);

        if (isLiked) {
            // Unlike: Remove from User array, Decrement Post count
            await User.findByIdAndUpdate(userId, { $pull: { likedPosts: postId } });
            await Post.findByIdAndUpdate(postId, { $inc: { likesCount: -1 } });

            return res.status(200).json(new ApiResponse(200, "Unliked", { isLiked: false, likesCount: post.likesCount - 1 }));
        } else {
            // Like: Add to User array, Increment Post count
            await User.findByIdAndUpdate(userId, { $addToSet: { likedPosts: postId } });
            await Post.findByIdAndUpdate(postId, { $inc: { likesCount: 1 } });

            return res.status(200).json(new ApiResponse(200, "Liked", { isLiked: true, likesCount: post.likesCount + 1 }));
        }
    } catch (error) {
        next(error);
    }
};

export const toggleSave = async (req, res, next) => {
    try {
        const { id: postId } = req.params;
        const userId = req.user._id;

        const user = await User.findById(userId);
        const isSaved = user.savedPosts.includes(postId);

        if (isSaved) {
            // Unsave
            await User.findByIdAndUpdate(userId, { $pull: { savedPosts: postId } });
            return res.status(200).json(new ApiResponse(200, "Removed from saved", { isSaved: false }));
        } else {
            // Save
            await User.findByIdAndUpdate(userId, { $addToSet: { savedPosts: postId } });
            return res.status(200).json(new ApiResponse(200, "Saved", { isSaved: true }));
        }
    } catch (error) {
        next(error);
    }
};

export const toggleFollow = async (req, res, next) => {
    try {
        const { id: creatorId } = req.params;
        const userId = req.user._id;

        if (creatorId.toString() === userId.toString()) {
            throw new ApiError(400, "You cannot follow yourself");
        }

        const user = await User.findById(userId);
        const isFollowing = user.following.includes(creatorId);

        if (isFollowing) {
            // Unfollow: Remove creator from my 'following', Remove me from creator's 'followers'
            await User.findByIdAndUpdate(userId, { $pull: { following: creatorId } });
            await User.findByIdAndUpdate(creatorId, { $pull: { followers: userId } });

            return res.status(200).json(new ApiResponse(200, "Unfollowed", { isFollowed: false }));
        } else {
            // Follow
            await User.findByIdAndUpdate(userId, { $addToSet: { following: creatorId } });
            await User.findByIdAndUpdate(creatorId, { $addToSet: { followers: userId } });

            return res.status(200).json(new ApiResponse(200, "Followed", { isFollowed: true }));
        }
    } catch (error) {
        next(error);
    }
};

export const getFollowingList = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id).populate("following", "displayName username avatar role");
        return res.status(200).json(new ApiResponse(200, "Following list fetched", user.following));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* COMMERCE & SUBSCRIPTIONS                                                   */
/* ========================================================================== */

export const subscribeToCreator = async (req, res, next) => {
    try {
        const { creatorId, tierId } = req.body;

        // Check if already subscribed
        const existingSub = await Subscription.findOne({
            subscriberId: req.user._id,
            creatorId,
            status: "active",
        });

        if (existingSub) throw new ApiError(400, "Already subscribed to this creator");

        // Create Subscription
        const subscription = await Subscription.create({
            subscriberId: req.user._id,
            creatorId,
            tierId,
            status: "active",
            paymentSubscriptionId: `sub_${Date.now()}`, // Mock ID
        });

        // Add to User's purchased interactions
        // In a real app, you'd likely depend on the Subscription model query, 
        // but for fast frontend logic, we can push to User model too if needed.

        return res.status(201).json(new ApiResponse(201, "Subscribed successfully", subscription));
    } catch (error) {
        next(error);
    }
};

export const unsubscribeFromCreator = async (req, res, next) => {
    try {
        const { id: creatorId } = req.params; // Or req.body, depends on your route definition. Let's assume params for REST.

        const subscription = await Subscription.findOneAndUpdate(
            { subscriberId: req.user._id, creatorId, status: "active" },
            { status: "cancelled" },
            { new: true }
        );

        if (!subscription) throw new ApiError(404, "Active subscription not found");

        return res.status(200).json(new ApiResponse(200, "Unsubscribed successfully"));
    } catch (error) {
        next(error);
    }
};

export const purchaseItem = async (req, res, next) => {
    try {
        const { id, type } = req.body; // type: 'post' or 'collection'
        const userId = req.user._id;

        // 1. Verify Payment (Mock)
        const isPaymentSuccessful = true;
        if (!isPaymentSuccessful) throw new ApiError(400, "Payment failed");

        // 2. Add to User's library
        if (type === 'post') {
            await User.findByIdAndUpdate(userId, { $addToSet: { purchasedPosts: id } });
        } else if (type === 'collection') {
            await User.findByIdAndUpdate(userId, { $addToSet: { purchasedCollections: id } });
        }

        return res.status(200).json(new ApiResponse(200, "Purchase successful"));
    } catch (error) {
        next(error);
    }
};