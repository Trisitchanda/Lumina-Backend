import mongoose from "mongoose";
import constants from "../constants.js";

const connectToDb = async () => {
    try {
        const connectionInstance = await mongoose.connect(constants.MONGO_URI);
        console.log(`MongoDB Connected: ${connectionInstance.connection.host}`);
    } catch (error) {
        console.log("Error while connecting to DB: ", error);
        // Exit process with failure
        process.exit(1);
    }
};

export default connectToDb;