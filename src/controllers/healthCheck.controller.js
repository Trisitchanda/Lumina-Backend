import { ApiError, ApiResponse } from "../utils/index.js";
import mongoose from "mongoose";

export const handleHealthCheck = async (req, res) => {
    return res
        .status(200)
        .json(new ApiResponse(200, "Server is up and running"));
};

export const handleDbPing = async (req, res) => {
    try {
        const resp = await mongoose.connection.db.admin().ping();
        return res
            .status(200)
            .json(new ApiResponse(200, "DB is up and running", resp));
    } catch (err) {
        res.status(500).json("DB ping failed");
    }
};