import app from "./app.js";
import constants from "./constants.js";
import connectToDb from "./configs/mongodb.config.js";
import dotenv from "dotenv";
dotenv.config();

const port = constants.PORT || 5000;

// First trying to connect to db. If error then exit
connectToDb().then(() => {
    // starting the server
    app.listen(port, () =>
        console.log(`Server is running. URL: http://localhost:${port}`)
    );
});