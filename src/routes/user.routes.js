import { Router } from "express";
import {
    handleRegister,
    handleLogin,
    handleLogout,
    handleChangeAvatar,
} from "../controllers/user.controller.js";
import { isLoggedIn } from "../middlewares/auth.middleware.js";
import upload from "../middlewares/multar.middleware.js";

const userRoutes = Router();

// auth routes
userRoutes.route("/register").post( upload.single("avatar"),handleRegister);
userRoutes.route("/login").post(handleLogin);
userRoutes.route("/logout").get(isLoggedIn, handleLogout);
userRoutes
    .route("/change-avatar")
    .post(isLoggedIn, upload.single("avatar"), handleChangeAvatar);

export default userRoutes;