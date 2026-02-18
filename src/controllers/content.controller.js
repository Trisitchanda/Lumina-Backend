import { Post } from "../models/post.model.js";
import { Like } from "../models/like.model.js";
import { SavedPost } from "../models/savepost.model.js";
import { Collection } from "../models/collection.model.js";
import { Tier } from "../models/tier.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Purchase } from "../models/purchase.model.js"; // Critical for access control
import User from "../models/user.models.js";
import { ApiError, ApiResponse, uploadImageToCloud,deleteCloudFile } from "../utils/index.js";

/* ========================================================================== */
/* HELPERS                                                                    */
/* ========================================================================== */

const injectInteractionStatus = async (posts, userId) => {
    if (!userId || posts.length === 0) {
        return posts.map(post => ({ ...post, isLiked: false, isSaved: false }));
    }

    const postIds = posts.map(p => p._id);

    // Fetch Likes and Saves in parallel
    const [likes, saves] = await Promise.all([
        Like.find({ 
            userId: userId, 
            targetId: { $in: postIds }, 
            targetType: "Post" 
        }).select("targetId").lean(),
        
        SavedPost.find({ 
            user: userId, 
            post: { $in: postIds } 
        }).select("post").lean()
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

    // Guest users only access public/free content
    if (!userId) {
        return posts.map(post => ({
            ...post,
            hasAccess: !post.isPaid && !post.isMembersOnly
        }));
    }

    const postIds = posts.map(p => p._id);
    
    // Extract creator IDs safely (handling populated vs unpopulated)
    const creatorIds = [...new Set(posts.map(p => 
        p.creatorId?._id ? p.creatorId._id.toString() : p.creatorId.toString()
    ))];

    // 1. Fetch Purchases
    const purchases = await Purchase.find({
        userId: userId,
        targetId: { $in: postIds },
        targetType: 'Post',
        status: 'completed'
    }).select('targetId').lean();

    const purchasedSet = new Set(purchases.map(p => p.targetId.toString()));

    // 2. Fetch Active Subscriptions
    const subscriptions = await Subscription.find({
        subscriberId: userId,
        creatorId: { $in: creatorIds },
        status: 'active',
        currentPeriodEnd: { $gt: new Date() }
    }).select('creatorId tierId').lean();

    // Map subscriptions: { "creatorId": Set(["tierId1", "tierId2"]) }
    const subsMap = {};
    subscriptions.forEach(sub => {
        const cId = sub.creatorId.toString();
        if (!subsMap[cId]) subsMap[cId] = new Set();
        subsMap[cId].add(sub.tierId.toString());
    });

    return posts.map(post => {
        const cId = post.creatorId?._id ? post.creatorId._id.toString() : post.creatorId.toString();
        let hasAccess = false;

        // A. Creator Access
        if (cId === userId.toString()) {
            hasAccess = true;
        }
        // B. Free Content
        else if (!post.isPaid && !post.isMembersOnly) {
            hasAccess = true;
        }
        // C. Purchased Post
        else if (post.isPaid && purchasedSet.has(post._id.toString())) {
            hasAccess = true;
        }
        // D. Subscription Access
        else if (post.isMembersOnly && subsMap[cId] && post.allowedTiers) {
            const userTiers = subsMap[cId];
            if (post.allowedTiers.some(tid => userTiers.has(tid.toString()))) {
                hasAccess = true;
            }
        }

        return { ...post, hasAccess };
    });
};

/* ========================================================================== */
/* FEED CONTROLLER                                                            */
/* ========================================================================== */

export const getFeed = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const rawPosts = await Post.find({ isDraft: false })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("creatorId", "displayName username avatar isVerified")
            .lean();

        const postsWithStatus = await injectInteractionStatus(rawPosts, req.user?._id);
        // Note: For a general feed, you might not run injectAccessStatus for performance 
        // unless you want to show locks on the feed immediately.

        const totalPosts = await Post.countDocuments({ isDraft: false });
        const hasMore = totalPosts > skip + rawPosts.length;

        return res.status(200).json(
            new ApiResponse(200, "Feed fetched", {
                posts: postsWithStatus,
                page,
                hasMore
            })
        );
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* POST CRUD                                                                  */
/* ========================================================================== */

export const createPost = async (req, res, next) => {
    try {
        const {
            title,
            description,
            type,
            isPaid,
            price,
            isDraft,
            isMembersOnly,
            allowedTiers,
            pollOptions
        } = req.body;

        let coverImageData = null;
        let mediaArray = [];

        // Image Upload
        if (req.files && req.files.image) {
            const imgFile = req.files.image[0];
            const uploadedImg = await uploadImageToCloud(imgFile.path);
            if (uploadedImg) {
                coverImageData = {
                    public_id: uploadedImg.public_id,
                    secure_url: uploadedImg.secure_url,
                };
                // Only add to media array if it's explicitly an image type post
                if (type === 'image') {
                    mediaArray.push({
                        public_id: uploadedImg.public_id,
                        secure_url: uploadedImg.secure_url,
                        type: 'image'
                    });
                }
            }
        }

        // Audio Upload
        if (req.files && req.files.audio) {
            const audioFile = req.files.audio[0];
            const uploadedAudio = await uploadImageToCloud(audioFile.path);
            if (uploadedAudio) {
                mediaArray.push({
                    public_id: uploadedAudio.public_id,
                    secure_url: uploadedAudio.secure_url,
                    type: 'audio'
                });
            }
        }

        // Parse JSON fields safely
        let parsedPollOptions = [];
        if (pollOptions) {
            try {
                const optionsArray = JSON.parse(pollOptions);
                parsedPollOptions = optionsArray.map(opt => ({ text: opt, votes: 0 }));
            } catch (e) {
                console.error("Poll parse error", e);
            }
        }

        let parsedAllowedTiers = [];
        if (allowedTiers) {
            try {
                parsedAllowedTiers = JSON.parse(allowedTiers);
            } catch (e) {
                console.error("Tiers parse error", e);
            }
        }

        const post = await Post.create({
            creatorId: req.user._id,
            title: title?.trim(),
            content: description?.trim(),
            type: type || "text",
            isPaid: isPaid === "true" || isPaid === true,
            price: Number(price) || 0,
            isDraft: isDraft === "true" || isDraft === true,
            isMembersOnly: isMembersOnly === "true" || isMembersOnly === true,
            pollOptions: parsedPollOptions,
            coverImage: coverImageData,
            media: mediaArray,
            allowedTiers: parsedAllowedTiers,
        });

        return res.status(201).json(new ApiResponse(201, "Post created successfully", post));
    } catch (error) {
        next(error);
    }
};

export const updatePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const post = await Post.findOne({ _id: id, creatorId: req.user._id });
        if (!post) throw new ApiError(404, "Post not found or unauthorized");

        if (req.file) {
            const uploaded = await uploadImageToCloud(req.file.path);
            updates.coverImage = { public_id: uploaded.public_id, secure_url: uploaded.secure_url };
        }

        const updatedPost = await Post.findByIdAndUpdate(id, updates, { new: true })
            .populate("creatorId", "displayName username avatar");

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

export const getMyPosts = async (req, res, next) => {
    try {
        const posts = await Post.find({ creatorId: req.user._id })
            .sort({ createdAt: -1 })
            .populate("creatorId", "displayName username avatar");
        return res.status(200).json(new ApiResponse(200, "My posts fetched", posts));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* PUBLIC VIEWING (SECURE)                                                    */
/* ========================================================================== */

export const getCreatorPosts = async (req, res, next) => {
    try {
        const { creatorId } = req.params;
        const userId = req.user?._id; 

        // 1. Fetch minimal fields
        const rawPosts = await Post.find({
            creatorId: creatorId,
            isDraft: false
        })
            .select("_id title coverImage likesCount commentsCount type isPaid isMembersOnly price createdAt creatorId allowedTiers content")
            .sort({ createdAt: -1 })
            .populate("creatorId", "displayName username avatar")
            .lean(); 

        // 2. Inject Interaction Status
        let processedPosts = await injectInteractionStatus(rawPosts, userId);

        // 3. Inject Access Status
        processedPosts = await injectAccessStatus(processedPosts, userId);

        // 4. Sanitize Content based on Access
        const securedPosts = processedPosts.map(post => {
            if (!post.hasAccess) {
                // If Locked: Remove media and sensitive content
                return {
                    ...post,
                    coverImage: post.type === "image" ? null : post.coverImage, // Hide main image if it's the content
                    media: [], 
                    content: post.content ? post.content.substring(0, 100) + "..." : "", // Truncate text
                    isLocked: true
                };
            }
            return post;
        });

        return res.status(200).json(
            new ApiResponse(200, "Creator posts fetched securely", securedPosts)
        );
    } catch (error) {
        next(error);
    }
};

export const getPostById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user?._id;

        const rawPost = await Post.findById(id)
            .populate("creatorId", "displayName username avatar isVerified")
            .lean();

        if (!rawPost) throw new ApiError(404, "Post not found");

        // Inject Statuses
        const [postWithStatus] = await injectInteractionStatus([rawPost], userId);
        const [postWithAccess] = await injectAccessStatus([postWithStatus], userId);

        // If Access Denied, return restricted payload
        if (!postWithAccess.hasAccess) {
            const safePreview = {
                _id: postWithAccess._id,
                title: postWithAccess.title,
                type: postWithAccess.type,
                price: postWithAccess.price,
                isPaid: postWithAccess.isPaid,
                isMembersOnly: postWithAccess.isMembersOnly,
                creatorId: postWithAccess.creatorId,
                createdAt: postWithAccess.createdAt,
                likesCount: postWithAccess.likesCount,
                commentsCount: postWithAccess.commentsCount,
                isLiked: postWithAccess.isLiked,
                isSaved: postWithAccess.isSaved,
                allowedTiers: postWithAccess.allowedTiers,
                // Hide content if it's an image post
                coverImage: postWithAccess.type === "image" ? null : postWithAccess.coverImage,
                content: postWithAccess.content ? postWithAccess.content.substring(0, 50) + "..." : "",
                media: [],
                pollOptions: [],
                isLocked: true,
                hasAccess: false
            };

            return res.status(200).json(new ApiResponse(200, "Post preview (Locked)", safePreview));
        }

        // Access Granted
        return res.status(200).json(new ApiResponse(200, "Post fetched", postWithAccess));

    } catch (error) {
        next(error);
    }
};

export const getDashboardData = async (req, res, next) => {
    try {
        const userId = req.user._id;

        const [savedDocs, purchaseDocs, subDocs] = await Promise.all([
            SavedPost.find({ user: userId })
                .sort({ createdAt: -1 })
                .populate({
                    path: 'post',
                    match: { isDraft: false },
                    populate: { path: 'creatorId', select: 'displayName username avatar' }
                }).lean(),

            // FIX: Query the Purchase collection, not User array
            Purchase.find({ userId: userId, targetType: 'Post', status: 'completed' })
                .sort({ createdAt: -1 })
                .populate({
                    path: 'targetId',
                    match: { isDraft: false },
                    populate: { path: 'creatorId', select: 'displayName username avatar' }
                }).lean(),

            Subscription.find({ subscriberId: userId, status: 'active' })
                .sort({ createdAt: -1 })
                .populate('creatorId', 'displayName username avatar')
                .lean()
        ]);

        const rawSavedPosts = savedDocs.map(doc => doc.post).filter(Boolean);
        const rawPurchasedPosts = purchaseDocs.map(doc => doc.targetId).filter(Boolean);

        const [processedSaved, processedPurchased] = await Promise.all([
            injectInteractionStatus(rawSavedPosts, userId).then(p => injectAccessStatus(p, userId)),
            injectInteractionStatus(rawPurchasedPosts, userId).then(p => injectAccessStatus(p, userId))
        ]);

        return res.status(200).json(
            new ApiResponse(200, "Dashboard data fetched", {
                savedPosts: processedSaved,
                purchasedPosts: processedPurchased,
                subscriptions: subDocs
            })
        );
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
        const targetId = creatorId || req.user._id;
        const collections = await Collection.find({ creatorId: targetId }).sort({ createdAt: -1 });
        return res.status(200).json(new ApiResponse(200, "Collections fetched", collections));
    } catch (error) {
        next(error);
    }
};

export const createCollection = async (req, res, next) => {
    try {
        const { title, description, isPaid, price } = req.body;
        
        // 1. Parse postIds safely
        let postIds = [];
        if (req.body.postIds) {
            try {
                // If it's a string (from FormData), parse it. 
                // If it's already an array (from JSON body), use it as is.
                postIds = typeof req.body.postIds === 'string' 
                    ? JSON.parse(req.body.postIds) 
                    : req.body.postIds;
            } catch (e) {
                // Fallback: If parsing fails, maybe it's just a single ID string
                postIds = [req.body.postIds];
            }
        }

        // 2. Handle Image Upload
        let coverImageData = null;
        if (req.file) {
            const uploadedImg = await uploadImageToCloud(req.file.path);
            if (uploadedImg) {
                coverImageData = {
                    public_id: uploadedImg.public_id,
                    secure_url: uploadedImg.secure_url,
                };
            }
        }

        // 3. Verify ownership of posts
        if (postIds.length > 0) {
            const count = await Post.countDocuments({ 
                _id: { $in: postIds }, // Now this is a real Array, so $in works
                creatorId: req.user._id 
            });
            if (count !== postIds.length) {
                throw new ApiError(403, "One or more posts do not belong to you");
            }
        }

        // 4. Create
        const collection = await Collection.create({
            creatorId: req.user._id,
            title,
            description,
            posts: postIds, // Use the parsed array
            isPaid: isPaid === "true" || isPaid === true,
            price: Number(price) || 0,
            coverImage: coverImageData
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

        // 1. Find the collection first (so we can access the image data)
        const collection = await Collection.findOne({ _id: id, creatorId: req.user._id });

        if (!collection) {
            throw new ApiError(404, "Collection not found or unauthorized");
        }

        // 2. If it has a cover image, delete it from the cloud
        if (collection.coverImage && collection.coverImage.public_id) {
            try {
                await deleteCloudFile(collection.coverImage.public_id);
            } catch (err) {
                console.error("Failed to delete image from cloud:", err);
                // We usually continue deleting the DB record even if image deletion fails
            }
        }

        // 3. Delete the collection document
        await Collection.findByIdAndDelete(id);

        return res.status(200).json(new ApiResponse(200, "Collection deleted"));
    } catch (error) {
        next(error);
    }
};

// 1. Get Single Collection (Public/Viewer)
// Matches: GET /content/creator/collections/:id
export const getCollectionById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user?._id;

        // Fetch collection and populate creator AND posts
        const collection = await Collection.findById(id)
            .populate("creatorId", "displayName username avatar")
            .populate({
                path: "posts",
                match: { isDraft: false }, // Only show published posts
                select: "_id title coverImage type isPaid price likesCount commentsCount", // Select fields for list view
                populate: { path: "creatorId", select: "displayName username" }
            })
            .lean();

        if (!collection) {
            throw new ApiError(404, "Collection not found");
        }

        // Check Access (Is it my collection? Is it free? Did I buy it?)
        let hasAccess = false;
        
        // A. I am the creator
        if (userId && collection.creatorId._id.toString() === userId.toString()) {
            hasAccess = true;
        }
        // B. It's free
        else if (!collection.isPaid) {
            hasAccess = true;
        }
        // C. I bought it
        else if (userId && collection.isPaid) {
            const purchase = await Purchase.exists({
                userId,
                targetId: collection._id,
                targetType: 'Collection',
                status: 'completed'
            });
            if (purchase) hasAccess = true;
        }

        // Inject Access Flag for Frontend UI
        collection.hasAccess = hasAccess;

        return res.status(200).json(
            new ApiResponse(200, "Collection fetched", collection)
        );

    } catch (error) {
        next(error);
    }
};

// 2. Remove Post from Collection
// Matches: DELETE /content/collections/:collectionId/posts/:postId
export const removePostFromCollection = async (req, res, next) => {
    try {
        const { collectionId, postId } = req.params;
        const userId = req.user._id;

        // Use findOneAndUpdate to ensure ownership (creatorId: userId)
        const collection = await Collection.findOneAndUpdate(
            { _id: collectionId, creatorId: userId },
            { $pull: { posts: postId } }, // $pull removes item from array
            { new: true }
        );

        if (!collection) {
            throw new ApiError(404, "Collection not found or unauthorized");
        }

        return res.status(200).json(
            new ApiResponse(200, "Post removed from collection", collection)
        );

    } catch (error) {
        next(error);
    }
};

// 3. Move Post Between Collections
// Matches: PUT /content/collections/move-post
export const movePostBetweenCollections = async (req, res, next) => {
    try {
        const { postId, fromCollectionId, toCollectionId } = req.body;
        const userId = req.user._id;

        // Security Check: Verify user owns BOTH collections
        const count = await Collection.countDocuments({
            _id: { $in: [fromCollectionId, toCollectionId] },
            creatorId: userId
        });

        if (count !== 2) {
            throw new ApiError(403, "You do not own one or both collections");
        }

        // 1. Remove from Source
        await Collection.findByIdAndUpdate(fromCollectionId, {
            $pull: { posts: postId }
        });

        // 2. Add to Destination (using $addToSet to prevent duplicates)
        const updatedDest = await Collection.findByIdAndUpdate(toCollectionId, {
            $addToSet: { posts: postId }
        }, { new: true });

        return res.status(200).json(
            new ApiResponse(200, "Post moved successfully", updatedDest)
        );

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
        const targetId = creatorId || req.user._id;
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
        const activeSubs = await Subscription.exists({ tierId: req.params.id, status: "active" });
        if (activeSubs) throw new ApiError(400, "Cannot delete tier with active subscribers.");

        const tier = await Tier.findOneAndDelete({ _id: req.params.id, creatorId: req.user._id });
        if (!tier) throw new ApiError(404, "Tier not found");
        return res.status(200).json(new ApiResponse(200, "Tier deleted"));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* INTERACTIONS                                                               */
/* ========================================================================== */

export const toggleLike = async (req, res, next) => {
    try {
        const { id: postId } = req.params;
        const userId = req.user._id;

        const post = await Post.findById(postId);
        if (!post) throw new ApiError(404, "Post not found");

        const existingLike = await Like.findOne({ targetId: postId, userId, targetType: "Post" });
        let isLiked, updatedLikesCount;

        if (existingLike) {
            await Like.findByIdAndDelete(existingLike._id);
            const p = await Post.findByIdAndUpdate(postId, { $inc: { likesCount: -1 } }, { new: true });
            isLiked = false;
            updatedLikesCount = p.likesCount;
        } else {
            await Like.create({ targetId: postId, targetType: "Post", userId });
            const p = await Post.findByIdAndUpdate(postId, { $inc: { likesCount: 1 } }, { new: true });
            isLiked = true;
            updatedLikesCount = p.likesCount;
        }

        return res.status(200).json(new ApiResponse(200, isLiked ? "Liked" : "Unliked", { isLiked, likesCount: updatedLikesCount }));
    } catch (error) {
        if (error.code === 11000) return res.status(400).json(new ApiError(400, "Duplicate action"));
        next(error);
    }
};

export const toggleSave = async (req, res, next) => {
    try {
        const { id: postId } = req.params;
        const userId = req.user._id;

        const post = await Post.findById(postId);
        if (!post) throw new ApiError(404, "Post not found");

        const existingSave = await SavedPost.findOne({ user: userId, post: postId });
        let isSaved;

        if (existingSave) {
            await SavedPost.findByIdAndDelete(existingSave._id);
            isSaved = false;
        } else {
            await SavedPost.create({ user: userId, post: postId });
            isSaved = true;
        }

        return res.status(200).json(new ApiResponse(200, isSaved ? "Saved" : "Unsaved", { isSaved }));
    } catch (error) {
        if (error.code === 11000) return res.status(400).json(new ApiError(400, "Already saved"));
        next(error);
    }
};

export const toggleFollow = async (req, res, next) => {
    try {
        const { id: creatorId } = req.params;
        const userId = req.user._id;

        if (creatorId.toString() === userId.toString()) throw new ApiError(400, "Cannot follow yourself");

        const user = await User.findById(userId);
        const isFollowing = user.following.includes(creatorId);

        if (isFollowing) {
            await User.findByIdAndUpdate(userId, { $pull: { following: creatorId } });
            await User.findByIdAndUpdate(creatorId, { $pull: { followers: userId } });
            return res.status(200).json(new ApiResponse(200, "Unfollowed", { isFollowed: false }));
        } else {
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
        return res.status(200).json(new ApiResponse(200, "List fetched", user.following));
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* COMMERCE                                                                   */
/* ========================================================================== */

export const subscribeToCreator = async (req, res, next) => {
    try {
        const { creatorId, tierId } = req.body;
        const existingSub = await Subscription.findOne({ subscriberId: req.user._id, creatorId, status: "active" });
        if (existingSub) throw new ApiError(400, "Already subscribed");

        const subscription = await Subscription.create({
            subscriberId: req.user._id,
            creatorId,
            tierId,
            status: "active",
            paymentSubscriptionId: `sub_${Date.now()}`
        });

        return res.status(201).json(new ApiResponse(201, "Subscribed", subscription));
    } catch (error) {
        next(error);
    }
};

export const unsubscribeFromCreator = async (req, res, next) => {
    try {
        const { id: creatorId } = req.params;
        const subscription = await Subscription.findOneAndUpdate(
            { subscriberId: req.user._id, creatorId, status: "active" },
            { status: "cancelled" },
            { new: true }
        );
        if (!subscription) throw new ApiError(404, "No active subscription");
        return res.status(200).json(new ApiResponse(200, "Unsubscribed"));
    } catch (error) {
        next(error);
    }
};

export const purchaseItem = async (req, res, next) => {
    try {
        const { id, type } = req.body; // type: 'Post' or 'Collection'
        const userId = req.user._id;

        // Verify content exists
        let item;
        if (type === 'Post') item = await Post.findById(id);
        else if (type === 'Collection') item = await Collection.findById(id);
        
        if (!item) throw new ApiError(404, "Item not found");

        // [FIX]: Create a Record in Purchase Collection (Source of Truth)
        await Purchase.create({
            userId,
            targetId: id,
            targetType: type, // Ensure casing matches your model enum (e.g., 'Post', 'Collection')
            price: item.price,
            status: 'completed',
            paymentId: `pay_${Date.now()}` // Mock payment
        });

        return res.status(200).json(new ApiResponse(200, "Purchase successful"));
    } catch (error) {
        next(error);
    }
};