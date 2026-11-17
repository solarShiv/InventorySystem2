const router = require("express").Router();
const uploadPurchaseOrderBill = require("../../../middlewares/rawMaterialMiddlewares/multerConfigPurchase");
const {
  tokenVerification,
} = require("../../../middlewares/rawMaterialMiddlewares/tokenVerification");
const {
purchaseOrderReceivingBill
} = require("../../../controllers/v2/rawMaterial/storeKeeper.controller");




router.post(
  "/purchaseOrder/receive",
  tokenVerification(["Store"]),
  uploadPurchaseOrderBill,
  purchaseOrderReceivingBill,
);
module.exports = router;