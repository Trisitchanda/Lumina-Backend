import express from "express";
import errorMiddleware from "./middlewares/error.middleware.js";
import {
    userRoutes,
} from "./routes/index.js";
import cookieParser from "cookie-parser";
import constants from "./constants.js";
import cors from "cors";

const app = express();

// cors setup
const corsOptions = {
    origin: constants.ALLOWED_ORIGINS,
    credentials: true, // cookie accept
};

// middlewares
app.use(express.json()); // to handle json data
app.use(express.urlencoded({ extended: true })); // to handle url encoded data like form data
app.use(cookieParser()); // to handle cookies
app.use(cors(corsOptions));

// routes
// app.use("/api/test", healthCheckRoutes); // health check routes
app.use("/api/user", userRoutes);

// handling all other incorrect routes
app.all(/./, (req, res) => {
    res.status(404).json({ message: "Page does not exist" });
});

// error middleware
app.use(errorMiddleware);
export default app;