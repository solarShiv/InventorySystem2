const express = require("express");
const router = express.Router();

const verifyApiKey = require("../middlewares/verifyApiKey");
const externalAPIController = require("../controllers/serviceControllers/externalAPIController");
const {
    PO_list_for_inverter
 } = require("../controllers/rawMaterialItemsController/external.controller");

router.get("/api/vehicle/delivery-status", externalAPIController.getVehicleReceiptStatusToday);
router.get("/inverter-po-list", verifyApiKey, PO_list_for_inverter);
module.exports = router;