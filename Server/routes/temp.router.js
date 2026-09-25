const router = require("express").Router();
const {
    exportPurchaseOrders,
    downloadCompaniesExcel,
    downloadVendorExcel,
    po_list
} = require("../controllers/temp.controller");
// router.get("/PO", exportPurchaseOrders);
router.get("/company", downloadCompaniesExcel);
router.get("/vendor", downloadVendorExcel);
router.get("/po", po_list);
module.exports = router;