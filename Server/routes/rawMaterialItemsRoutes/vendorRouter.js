const express = require("express");
const router = express.Router();
const vendorController = require("../../controllers/rawMaterialItemsController/vendorController");
const {
  tokenVerification,
} = require("../../middlewares/rawMaterialMiddlewares/tokenVerification");

// Single payment list API - all filters via query params (see controller doc)
router.get(
  "/payments",
  tokenVerification(["Purchase", "Admin"]),
  vendorController.getPaymentList,
);

module.exports = router;
