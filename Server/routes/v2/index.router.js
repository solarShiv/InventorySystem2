const router = require("express").Router();
const storeKeeperRouter = require("./rowMaterial/storeKeeper.router");

router.use("/store-keeper", storeKeeperRouter);

module.exports = router;