const dotenv = require("dotenv");
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
dotenv.config();
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");

const app = express();

// MongoDB - Service Inventory Management System Routes
const authRoute = require("./routes/authRoute");
const adminRoute = require("./routes/adminRoutes");
const commonRoute = require("./routes/commonRoutes");
const externalRoute = require("./routes/externalRoutes");
const warehousePersonRoute = require("./routes/warehousePersonRoutes");
const servicePersonRoute = require("./routes/servicePersonRoutes");
const serviceTeamRoute = require("./routes/serviceTeamRoutes");


// MySQL - Raw Material Management System Routes
const authRouter = require("./routes/rawMaterialItemsRoutes/authRouter");
const adminRouter = require("./routes/rawMaterialItemsRoutes/adminRouter");
const commonRouter = require("./routes/rawMaterialItemsRoutes/commonRouter");
const lineWorkerRouter = require("./routes/rawMaterialItemsRoutes/lineWorkerRouter");
const storekeeperRouter = require("./routes/rawMaterialItemsRoutes/storekeeperRouter");
const purchaseRouter = require("./routes/rawMaterialItemsRoutes/purchaseRouter");
const userRouter = require("./routes/rawMaterialItemsRoutes/userRouter");
const verificationRouter = require("./routes/rawMaterialItemsRoutes/verificationRouter");
const accountsRouter = require("./routes/rawMaterialItemsRoutes/accountsRouter");
const testRouter = require("./routes/test");
const tempRouter = require("./routes/temp.router");
// ------------------------------
const prePoRouter = require('./routes/rawMaterialItemsRoutes/prePoRouter');

// Load environment variables
const MONGODB_URL = process.env.MONGODB_URL;
const PORT = process.env.PORT || 8001;

// MongoDB connection
mongoose
  .connect(MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Connected successfully to MongoDB");
    app.listen(PORT,() => {
      console.log(`✅ Server listening at port: ${PORT}`);
    });
  })
  .catch((err) => console.error("MongoDB connection error:", err));

// Middleware

// const allowedOrigins = [
//   "https://inventory.galosolam.com",
//   "https://www.inventory.galosolam.com",
//   "http://localhost:5173", // for local testing
// ];

// app.use(
//   cors({
//     origin: function (origin, callback) {
//       if (!origin) return callback(null, true); // allow mobile apps / postman

//       if (allowedOrigins.includes(origin)) {
//         callback(null, true);
//       } else {
//         callback(new Error("Not allowed by CORS"));
//       }
//     },
//     credentials: true,
//   })
// );

app.use(
  cors({
    origin: true, // Allow all origins during development
    // origin: 'http://122.176.93.11:5173',
    credentials: true, // Allow cookies to be sent
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const now = new Date();
  const istTime = new Date(now.getTime() + 5.5 * 60 * 60 * 1000) // Convert to IST
    .toISOString()
    .replace("T", " ") // Replace "T" with space for readability
    .replace("Z", " IST"); // Add "IST" at the end

  console.log(`[${istTime}] ${req.method} ${req.url}`);
  next();
});

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.get("/", (req, res) => {
  res.send("Server Working Fine");
});

app.use("/user", authRoute);
app.use("/admin", adminRoute);
app.use("/common", commonRoute);
app.use("/external", externalRoute);
app.use("/warehouse-admin", warehousePersonRoute);
app.use("/service-person", servicePersonRoute);
app.use("/service-team", serviceTeamRoute);



/* Raw Material Management System */
app.use("/auth", authRouter);
app.use("/admin", adminRouter);
app.use("/common", commonRouter);
app.use("/line-worker", lineWorkerRouter);
app.use("/store-keeper", storekeeperRouter);
app.use("/purchase", purchaseRouter);
app.use("/verification-dept", verificationRouter);
app.use("/accounts-dept", accountsRouter);
app.use("/user", userRouter);
app.use("/test", testRouter);
require("./helpers/cron/stockShortageCron");

app.use('/pre-po', prePoRouter);
app.use("/temp", tempRouter);

// require("./helpers/whatsapp/whatsappCron");

// Start the server
// app.listen(PORT, () => {
//   console.log(`✅ Server running at port: ${PORT}`);
// });
