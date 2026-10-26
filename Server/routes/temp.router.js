const router = require("express").Router();
const {
    exportPurchaseOrders,
    downloadCompaniesExcel,
    downloadVendorExcel
} = require("../controllers/temp.controller");
router.get("/PO", exportPurchaseOrders);
router.get("/company", downloadCompaniesExcel);
router.get("/vendor", downloadVendorExcel);

module.exports = router;