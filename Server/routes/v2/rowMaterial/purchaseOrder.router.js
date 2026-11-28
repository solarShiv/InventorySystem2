const router = require("express").Router();
const {
  tokenVerification,
} = require("../../../middlewares/rawMaterialMiddlewares/tokenVerification");
const {
  getPOList,
} = require("../../../controllers/v2/rawMaterial/purchaseOrder.controller");

router.get(
  "/purchase-orders/show",
  tokenVerification(["Purchase", "Admin"]),
  getPOList,
);

module.exports = router;
