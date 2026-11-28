const router = require("express").Router();
const storeKeeperRouter = require("./rowMaterial/storeKeeper.router");
const purchaseOrderRouter = require("./rowMaterial/purchaseOrder.router");

router.use("/store-keeper", storeKeeperRouter);
router.use("/purchase", purchaseOrderRouter);

module.exports = router;
