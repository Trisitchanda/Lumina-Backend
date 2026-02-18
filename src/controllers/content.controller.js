import { Post } from "../models/post.model.js";
import { Like } from "../models/like.model.js";
import { SavedPost } from "../models/savepost.model.js";
import { Collection } from "../models/collection.model.js";
import { Tier } from "../models/tier.model.js";
import { Subscription } from "../models/subscription.model.js";
import User from "../models/user.models.js";
import { ApiError, ApiResponse, uploadImageToCloud } from "../utils/index.js";
import { Purchase } from "../models/purchase.model.js";

/* ========================================================================== */
/* FEED                                                                       */
/* ========================================================================== */

/* ========================================================================== */
/* FEED                                                                       */
/* ========================================================================== */

const injectInteractionStatus = async (posts, userId) => {
    // 1. If no user or no posts, return early
    if (!userId || posts.length === 0) {
        return posts.map(post => ({ ...post, isLiked: false, isSaved: false }));
    }

    // 2. Get IDs of the posts we are checking
    const postIds = posts.map(p => p._id);

    // 3. FIX: Match the EXACT fields you used in toggleLike and toggleSave
    const [likes, saves] = await Promise.all([
        // Like uses userId and targetId
        Like.find({ 
            userId: userId, 
            targetId: { $in: postIds }, 
            targetType: "Post" 
        }).select("targetId").lean(),
        
        // SavedPost uses user and post
        SavedPost.find({ 
            user: userId, 
            post: { $in: postIds } 
        }).select("post").lean()
    ]);

    // 4. FIX: Use the correct field names when building the Set
    const likedSet = new Set(likes.map(l => l.targetId.toString()));
    const savedSet = new Set(saves.map(s => s.post.toString()));

    // 5. Merge status into the post objects
    return posts.map(post => ({
        ...post,
        isLiked: likedSet.has(post._id.toString()),
        isSaved: savedSet.has(post._id.toString())
    }));
};

/* ========================================================================== */
/* HELPER: INJECT ACCESS STATUS (BULK EVALUATION)                             */
/* ========================================================================== */
const injectAccessStatus = async (posts, userId) => {
    if (posts.length === 0) return posts;

    // 1. If user is not logged in, they only have access to free posts
    if (!userId) {
        return posts.map(post => ({
            ...post,
            hasAccess: !post.isPaid && !post.isMembersOnly
        }));
    }

    const postIds = posts.map(p => p._id);
    
    // Safely extract creator IDs (handling both populated objects and raw string IDs)
    const creatorIds = [...new Set(posts.map(p => 
        p.creatorId._id ? p.creatorId._id.toString() : p.creatorId.toString()
    ))];

    // 2. Fetch all purchases for these posts in ONE fast query
    const purchases = await Purchase.find({
        userId: userId,
        targetId: { $in: postIds },
        targetType: 'Post',
        status: 'completed'
    }).select('targetId').lean();

    const purchasedSet = new Set(purchases.map(p => p.targetId.toString()));

    // 3. Fetch all active subscriptions for these creators in ONE fast query
    const subscriptions = await Subscription.find({
        subscriberId: userId,
        creatorId: { $in: creatorIds },
        status: 'active',
        currentPeriodEnd: { $gt: new Date() }
    }).select('creatorId tierId').lean();

    // Map user's subscribed tiers for easy lookup: { "creatorId1": Set(["tierId1"]) }
    const subsMap = {};
    subscriptions.forEach(sub => {
        const cId = sub.creatorId.toString();
        if (!subsMap[cId]) subsMap[cId] = new Set();
        subsMap[cId].add(sub.tierId.toString());
    });

    // 4. Evaluate access for every post using our bulk data in memory
    return posts.map(post => {
        let hasAccess = false;
        const cId = post.creatorId._id ? post.creatorId._id.toString() : post.creatorId.toString();

        // Rule A: Creator owns their own post
        if (cId === userId.toString()) {
            hasAccess = true;
        }
        // Rule B: It's free content
        else if (!post.isPaid && !post.isMembersOnly) {
            hasAccess = true;
        }
        // Rule C: User explicitly purchased this specific post
        else if (post.isPaid && purchasedSet.has(post._id.toString())) {
            hasAccess = true;
        }
        // Rule D: User's tier subscription unlocks this post
        else if (post.isMembersOnly && subsMap[cId] && post.allowedTiers) {
            const userActiveTiers = subsMap[cId];
            const hasMatchingTier = post.allowedTiers.some(tierId => userActiveTiers.has(tierId.toString()));
            if (hasMatchingTier) hasAccess = true;
        }

        return { ...post, hasAccess };
    });
};

/* ========================================================================== */
/* CONTROLLER: GET FEED                                                      */
/* ========================================================================== */
export const getFeed = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // 1. Fetch Raw Posts (Fast & Lean)
        const rawPosts = await Post.find({ isDraft: false })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("creatorId", "displayName username avatar isVerified")
            .lean(); // Returns plain JS objects

        // 2. Inject Interaction Status (The Helper)
        const postsWithStatus = await injectInteractionStatus(rawPosts, req.user?._id);

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
/* POSTS CRUD                                                                 */
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

        // 2. Handle Image Upload (If present)
        if (req.files && req.files.image) {
            const imgFile = req.files.image[0];
            const uploadedImg = await uploadImageToCloud(imgFile.path);

            if (uploadedImg) {
                coverImageData = {
                    public_id: uploadedImg.public_id,
                    secure_url: uploadedImg.secure_url,
                };
                if (type === 'image') {
                    mediaArray.push({
                        public_id: uploadedImg.public_id,
                        secure_url: uploadedImg.secure_url,
                        type: 'image'
                    });
                }
            }
        }

        //Handle Audio Upload (If present)
        if (req.files && req.files.audio) {
            const audioFile = req.files.audio[0];
            const uploadedAudio = await uploadImageToCloud(audioFile.path); // Ensure your uploader handles audio!

            if (uploadedAudio) {
                mediaArray.push({
                    public_id: uploadedAudio.public_id,
                    secure_url: uploadedAudio.secure_url,
                    type: 'audio'
                });
            }
        }

        let parsedPollOptions = [];
        if (pollOptions) {
            const optionsArray = JSON.parse(pollOptions);

            // Transform ["Yes", "No"] -> [{ text: "Yes", votes: 0 }, { text: "No", votes: 0 }]
            parsedPollOptions = optionsArray.map(opt => ({
                text: opt,
                votes: 0
            }));
        }

        // 4. Create Post
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

            allowedTiers: allowedTiers ? JSON.parse(allowedTiers) : [],
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
/* GET CREATOR POSTS (Public)                                                 */
/* ========================================================================== */
export const getCreatorPosts = async (req, res, next) => {
    try {
        const { creatorId } = req.params;
        const userId = req.user?._id; 

        // 1. Fetch Posts but ONLY select the safe fields.
        const rawPosts = await Post.find({
            creatorId: creatorId,
            isDraft: false
        })
            .select("_id title coverImage likesCount commentsCount type isPaid isMembersOnly price createdAt creatorId allowedTiers")
            .sort({ createdAt: -1 })
            .populate("creatorId", "displayName username avatar")
            .lean(); 

        // 2. Inject isLiked and isSaved
        let processedPosts = await injectInteractionStatus(rawPosts, userId);

        // 3. Inject hasAccess (Checks Purchases & Subscriptions)
        processedPosts = await injectAccessStatus(processedPosts, userId);

        // 4. Sanitize Premium Images [THE FIX]
        const securedPosts = processedPosts.map(post => {
            // If the user doesn't have access AND the post is an image type...
            if (!post.hasAccess && post.type === "image") {
                return {
                    ...post,
                    coverImage: null // 🔒 Erase the image URL completely
                };
            }
            // Otherwise, return the post normally (text, video, or unlocked images)
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

        // 1. Fetch Post
        const rawPost = await Post.findById(id)
            .populate("creatorId", "displayName username avatar isVerified")
            .lean();

        if (!rawPost) {
            throw new ApiError(404, "Post not found");
        }

        // 2. Inject Interaction Status
        const [postWithStatus] = await injectInteractionStatus([rawPost], userId);

        // 3. Access Control Logic
        let hasAccess = false;
        const isCreator = userId && rawPost.creatorId._id.toString() === userId.toString();
        const isPublic = !rawPost.isPaid && !rawPost.isMembersOnly;

        if (isCreator || isPublic) {
            hasAccess = true;
        } 
        else if (userId) {
            // Check Purchases & Subscriptions in Parallel
            const checks = [];

            if (rawPost.isPaid) {
                checks.push(Purchase.exists({
                    userId,
                    targetId: rawPost._id,
                    targetType: 'Post',
                    status: 'completed'
                }));
            }

            if (rawPost.isMembersOnly && rawPost.allowedTiers?.length > 0) {
                checks.push(Subscription.exists({
                    subscriberId: userId,
                    creatorId: rawPost.creatorId._id,
                    tierId: { $in: rawPost.allowedTiers },
                    status: 'active',
                    currentPeriodEnd: { $gt: new Date() }
                }));
            }

            const results = await Promise.all(checks);
            if (results.some(r => !!r)) hasAccess = true;
        }

        // 4. Paywall / Strict Sanitization
        if (!hasAccess) {
            const isImagePost = postWithStatus.type === "image";
            // Create a strictly allowed payload with ONLY safe preview data
            const safePreviewPost = {
                _id: postWithStatus._id,
                title: postWithStatus.title,
                type: postWithStatus.type,
                price: postWithStatus.price,
                isPaid: postWithStatus.isPaid,
                isMembersOnly: postWithStatus.isMembersOnly,
                creatorId: postWithStatus.creatorId,
                createdAt: postWithStatus.createdAt,
                likesCount: postWithStatus.likesCount,
                commentsCount: postWithStatus.commentsCount,
                isLiked: postWithStatus.isLiked,
                isSaved: postWithStatus.isSaved,
                allowedTiers: postWithStatus.allowedTiers,
                coverImage: isImagePost ? null : postWithStatus.coverImage,
                
                // Show only a snippet of content (e.g., first 100 characters)
                content: postWithStatus.content 
                    ? postWithStatus.content.substring(0, 5) + "..." 
                    : "",
                
                // Force empty sensitive arrays
                media: [],
                pollOptions: [],
                attachments: [],
                
                // Explicit UI flags
                isLocked: true,
                hasAccess: false
            };

            // Return immediately to stop execution. The full post is NEVER sent.
            return res.status(200).json(
                new ApiResponse(200, "Post preview fetched (Locked)", safePreviewPost)
            );
        }

        // 5. User HAS access! Send the full payload.
        postWithStatus.isLocked = false;
        postWithStatus.hasAccess = true;

        return res.status(200).json(
            new ApiResponse(200, "Post fetched securely", postWithStatus)
        );

    } catch (error) {
        next(error);
    }
};

export const getDashboardData = async (req, res, next) => {
    try {
        const userId = req.user._id;

        // 1. Run all 3 database queries IN PARALLEL for maximum speed
        const [savedDocs, purchaseDocs, subDocs] = await Promise.all([
            // A. Fetch Saved Posts
            SavedPost.find({ user: userId })
                .sort({ createdAt: -1 })
                .populate({
                    path: 'post',
                    match: { isDraft: false },
                    populate: { path: 'creatorId', select: 'displayName username avatar' }
                })
                .lean(),

            // B. Fetch Purchased Posts
            Purchase.find({ userId: userId, targetType: 'Post', status: 'completed' })
                .sort({ createdAt: -1 })
                .populate({
                    path: 'targetId',
                    match: { isDraft: false },
                    populate: { path: 'creatorId', select: 'displayName username avatar' }
                })
                .lean(),

            // C. Fetch Active Subscriptions
            Subscription.find({ subscriberId: userId, status: 'active' })
                .sort({ createdAt: -1 })
                .populate('creatorId', 'displayName username avatar')
                .lean()
        ]);

        // 2. Extract the actual post objects (and filter out nulls if a post was deleted)
        const rawSavedPosts = savedDocs.map(doc => doc.post).filter(Boolean);
        const rawPurchasedPosts = purchaseDocs.map(doc => doc.targetId).filter(Boolean);

        // 3. Inject Interactions & Access Flags into the post arrays (Also in parallel!)
        const [processedSaved, processedPurchased] = await Promise.all([
            injectInteractionStatus(rawSavedPosts, userId).then(posts => injectAccessStatus(posts, userId)),
            injectInteractionStatus(rawPurchasedPosts, userId).then(posts => injectAccessStatus(posts, userId))
        ]);

        // 4. Send the ultimate unified payload!
        return res.status(200).json(
            new ApiResponse(200, "Dashboard data fetched successfully", {
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
            posts: postIds || [],
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
        // Default to requesting user if not specified
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

        const existingLike = await Like.findOne({
            targetId: postId,
            userId: userId,
            targetType: "Post"
        });

        let isLiked;
        let updatedLikesCount;

        if (existingLike) {
            // Remove the Like document
            await Like.findByIdAndDelete(existingLike._id);
            // Atomic Decrement. We use findByIdAndUpdate with { new: true } 
            // to get the REAL count from the DB, not a guess from memory.
            const updatedPost = await Post.findByIdAndUpdate(
                postId,
                { $inc: { likesCount: -1 } },
                { new: true }
            );

            isLiked = false;
            updatedLikesCount = updatedPost.likesCount;

        } else {
            // Create the Like document
            await Like.create({
                targetId: postId,
                targetType: "Post",
                userId: userId
            });

            // Atomic Increment
            const updatedPost = await Post.findByIdAndUpdate(
                postId,
                { $inc: { likesCount: 1 } },
                { new: true }
            );

            isLiked = true;
            updatedLikesCount = updatedPost.likesCount;
        }

        return res.status(200).json(
            new ApiResponse(200, isLiked ? "Liked" : "Unliked", {
                isLiked,
                likesCount: updatedLikesCount
            })
        );

    } catch (error) {
        // In case two requests hit at the exact same millisecond and both try to create a Like
        if (error.code === 11000) {
            return res.status(400).json(new ApiError(400, "You have already liked this post."));
        }
        next(error);
    }
};

export const toggleSave = async (req, res, next) => {
    try {
        const { id: postId } = req.params;
        const userId = req.user._id;

        // Verify Post Exists
        const post = await Post.findById(postId);
        if (!post) throw new ApiError(404, "Post not found");

        // Check for existing Save
        const existingSave = await SavedPost.findOne({
            user: userId,
            post: postId
        });

        let isSaved;

        if (existingSave) {
            // --- UNSAVE ---
            await SavedPost.findByIdAndDelete(existingSave._id);
            isSaved = false;
        } else {
            // --- SAVE ---
            await SavedPost.create({
                user: userId,
                post: postId
            });
            isSaved = true;
        }

        return res.status(200).json(
            new ApiResponse(200, isSaved ? "Post saved" : "Post unsaved", { isSaved })
        );

    } catch (error) {
        // Handle race condition where user double-clicks "Save"
        if (error.code === 11000) {
            return res.status(400).json(new ApiError(400, "Already saved"));
        }
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
        return res.status(201).json(new ApiResponse(201, "Subscribed successfully", subscription));
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