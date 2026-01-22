import { Router } from "express";
import {
    handleDbPing,
    handleHealthCheck,
} from "../controllers/healthCheck.controller.js";

const healthCheckRoutes = Router();

// Health check route
healthCheckRoutes.route("/").get(handleHealthCheck);

// db ping route
healthCheckRoutes.route("/db-ping").get(handleDbPing);

export default healthCheckRoutes;