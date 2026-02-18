import { Comment } from "../models/comment.model.js";
import { Post } from "../models/post.model.js";
import { ApiError, ApiResponse } from "../utils/index.js";
import mongoose from "mongoose";

/* ========================================================================== */
/* GET COMMENTS (Paginated & Optimized)                                       */
/* ========================================================================== */
export const getPostComments = async (req, res, next) => {
    try {
        const { postId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20; // Default 20 comments per load
        const skip = (page - 1) * limit;

        // 1. Database Query
        // We use .lean() for performance since we don't need Mongoose hydration methods here
        const comments = await Comment.find({ postId })
            .sort({ createdAt: -1 }) // Newest first
            .skip(skip)
            .limit(limit)
            .populate("userId", "displayName username avatar isVerified") // Lean select
            .lean();

        const totalComments = await Comment.countDocuments({ postId });
        const hasMore = totalComments > skip + comments.length;

        return res.status(200).json(
            new ApiResponse(200, "Comments fetched", {
                comments,
                page,
                hasMore,
                total: totalComments
            })
        );
    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* ADD COMMENT (Atomic Transaction)                                           */
/* ========================================================================== */
export const addComment = async (req, res, next) => {
    try {
        const { postId } = req.params;
        const { content, parentCommentId } = req.body;
        const userId = req.user._id;

        if (!content?.trim()) {
            throw new ApiError(400, "Comment content is required");
        }

        // 1. Verify Post Exists
        const postExists = await Post.exists({ _id: postId });
        if (!postExists) {
            throw new ApiError(404, "Post not found");
        }

        // 2. Create Comment
        const comment = await Comment.create({
            content: content.trim(),
            postId,
            userId,
            parentCommentId: parentCommentId || null
        });

        // 3. ATOMIC UPDATE: Increment post comment count
        // We do not wait for this to finish to send the response (Optimistic approach),
        // or we await it if data integrity is strictly required before UI update.
        await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

        // 4. Populate user details immediately so the UI can render the avatar/name
        // without needing a page refresh.
        await comment.populate("userId", "displayName username avatar isVerified");

        return res.status(201).json(
            new ApiResponse(201, "Comment added", comment)
        );

    } catch (error) {
        next(error);
    }
};

/* ========================================================================== */
/* DELETE COMMENT (With Ownership Check)                                      */
/* ========================================================================== */
export const deleteComment = async (req, res, next) => {
    try {
        const { commentId } = req.params;
        const userId = req.user._id;

        const comment = await Comment.findById(commentId);

        if (!comment) {
            throw new ApiError(404, "Comment not found");
        }

        // Authorization check
        if (comment.userId.toString() !== userId.toString()) {
            throw new ApiError(403, "You are not authorized to delete this comment");
        }

        // 1. Delete all replies first
        const deleteResult = await Comment.deleteMany({ parentCommentId: commentId });

        // 2. Calculate total deleted count (1 parent + N replies)
        const totalDeleted = 1 + (deleteResult.deletedCount || 0);

        // 3. Capture postId before deleting the parent
        const postId = comment.postId;

        // 4. Delete the parent comment
        await Comment.findByIdAndDelete(commentId);

        // 5. Update Post counter by the TOTAL amount deleted
        // [FIX WAS HERE]: Changed -1 to -totalDeleted
        await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: -totalDeleted } });

        return res.status(200).json(
            new ApiResponse(200, "Comment and replies deleted", { 
                commentId,
                totalDeleted // sending this back is helpful for frontend Redux state
            })
        );

    } catch (error) {
        next(error);
    }
};