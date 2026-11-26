const router = require("express").Router();
const upload = require("../middlewares/installationMiddlewares/multerBufferUpload");
const {
    exportPurchaseOrders,
    downloadCompaniesExcel,
    downloadVendorExcel,
    po_list,
    fillSystemItemIdInExcel
} = require("../controllers/temp.controller");
// router.get("/PO", exportPurchaseOrders);
router.get("/company", downloadCompaniesExcel);
router.get("/vendor", downloadVendorExcel);
router.get("/po", po_list);
router.post("/fill-system-item-id", upload.single('file'), fillSystemItemIdInExcel);
module.exports = router;