import path from "path";
import multer from "multer";
import { ApiError } from "../utils/index.js";

const storage = multer.diskStorage({
    destination: "./public/temp",

    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);

        const uniqueName = `${Date.now()}-${Math.round(
            Math.random() * 1e9
        )}${ext}`;

        cb(null, uniqueName);
    },
});

const fileFilter = (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        return cb(new ApiError(`Invalid file type: ${ext}`, 400), false);
    }

    cb(null, true);
};

const upload = multer({
    storage, // destinataion and filename settings
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter, // file type checking
});

export default upload;