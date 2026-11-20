const router = require("express").Router();
const uploadPurchaseOrderBill = require("../../../middlewares/rawMaterialMiddlewares/multerConfigPurchase");
const {
  tokenVerification,
} = require("../../../middlewares/rawMaterialMiddlewares/tokenVerification");
const {
purchaseOrderReceivingBill,
getPendingPOsForReceiving
} = require("../../../controllers/v2/rawMaterial/storeKeeper.controller");




router.post(
  "/purchaseOrder/receive",
  tokenVerification(["Store"]),
  uploadPurchaseOrderBill,
  purchaseOrderReceivingBill,
);
router.get("/getPendingPOsForReceiving",tokenVerification(["Store"]),getPendingPOsForReceiving);

module.exports = router;