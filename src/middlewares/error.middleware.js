import constants from "../constants.js";

const errorMiddleware = (err, req, res, next) => {
    // Get error details
    let { success, statusCode, message, stack, data } = err;

    if (constants.NODE_ENV === "development") {
        // Send error response
        return res.status(statusCode || 500).json({
            success,
            statusCode,
            message: message || "Something went wrong",
            stack: stack || "",
            data,
        });
    }

    // Send error response
    return res.status(statusCode || 500).json({
        success,
        statusCode,
        message: message || "Something went wrong",
        data,
    });
};

export default errorMiddleware;