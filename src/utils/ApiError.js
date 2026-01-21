class ApiError extends Error {
    constructor(statusCode = 500, message = "Operation Failed", data=null) {
        super(message);
        this.success = false;
        this.statusCode = Number(statusCode);
        this.data = data;
        Error.captureStackTrace(this, this.constructor);
    }
}

export default ApiError;