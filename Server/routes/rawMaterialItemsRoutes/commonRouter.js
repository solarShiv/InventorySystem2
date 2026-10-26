const express = require("express");
const router = express.Router();
const commonController = require("../../controllers/rawMaterialItemsController/commonController");
const purchaseOrderController = require("../../controllers/rawMaterialItemsController/purchaseOrderController");
const multerUpload = require("../../middlewares/multipleUpload.middleware");
const {
  tokenVerification,
} = require("../../middlewares/rawMaterialMiddlewares/tokenVerification");

router.post("/addRole", commonController.addRole);
router.get("/showRole", commonController.showRole);
router.delete("/deleteRole", commonController.deleteRole);
router.post(
  "/addItemRawMaterialFromExcel",
  commonController.upload.single("file"),
  commonController.addItemRawMaterialFromExcel,
);
router.delete(
  "/deleteItemRawMaterialFromExcel",
  commonController.upload.single("file"),
  commonController.deleteItemRawMaterialFromExcel,
);
router.post(
  "/updateRawMaterialsUnitByExcel",
  commonController.upload.single("file"),
  commonController.updateRawMaterialsUnitByExcel,
);
router.post(
  "/importRawMaterialsByExcel",
  commonController.upload.single("file"),
  commonController.importRawMaterialsByExcel,
);
router.post(
  "/updateRawMaterialStockByExcel",
  commonController.upload.single("file"),
  commonController.updateRawMaterialStockByExcel,
);
router.post(
  "/migrateServiceRecordJSON",
  commonController.migrateServiceRecordJSON,
);
router.post("/fixInvalidJSON", commonController.fixInvalidJSON);

router.post(
  "/addProduct",
  tokenVerification(["Admin", "Store"]),
  commonController.addProduct,
);
router.get(
  "/getProduct",
  tokenVerification([
    "Admin",
    "Store",
    "Disassemble",
    "Stamping",
    "SFG Work",
    "Winding",
    "Winding Connection",
    "Assemble",
    "Testing",
    "Admin",
    "Production",
  ]),
  commonController.getProduct,
);
router.delete(
  "/deleteProduct",
  tokenVerification(["Admin", "Store"]),
  commonController.deleteProduct,
);
router.post(
  "/addProductItemMap",
  tokenVerification(["Admin", "Store"]),
  commonController.addProductItemMap,
);
router.get(
  "/getItemsByProductId",
  tokenVerification([
    "Admin",
    "Store",
    "Disassemble",
    "Stamping",
    "SFG Work",
    "Winding",
    "Winding Connection",
    "Assemble",
    "Testing",
  ]),
  commonController.getItemsByProductId,
);
router.delete(
  "/deleteProductItemMap",
  tokenVerification(["Admin", "Store"]),
  commonController.deleteProductItemMap,
);
router.get(
  "/showDefectiveItemsList",
  tokenVerification([
    "Admin",
    "Store",
    "Disassemble",
    "Stamping",
    "SFG Work",
    "Winding",
    "Winding Connection",
    "Assemble",
    "Testing",
  ]),
  commonController.getDefectiveItemsListByWarehouse,
);
router.get(
  "/getItemType",
  tokenVerification(["Admin", "Store", "Production"]),
  commonController.getItemType,
);
router.post(
  "/addModel",
  tokenVerification(["Admin", "Store"]),
  commonController.addModel,
);
router.get(
  "/showModel",
  tokenVerification(["Admin", "Store"]),
  commonController.showModel,
);
router.get(
  "/getRawMaterialIdByName",
  commonController.upload.single("file"),
  commonController.getRawMaterialIdByName,
);
router.post(
  "/updateRawMaterialFromExcel",
  commonController.upload.single("file"),
  commonController.updateRawMaterialFromExcel,
);
router.post(
  "/updateRawMaterialUsageFromExcel",
  commonController.upload.single("file"),
  commonController.updateRawMaterialUsageFromExcel,
);

router.put(
  "/update/:id/:isActive",
  tokenVerification(["Purchase"]),
  commonController.markCompanyOrVendorNotActive,
);
router.post(
  "/raw-material/create",
  tokenVerification(["Purchase", "Store"]),
  commonController.createRawMaterial,
);
router.post(
  "/system-item/create",
  tokenVerification(["Purchase", "Store"]),
  commonController.createSystemItem,
);
router.post(
  "/item/create",
  tokenVerification(["Purchase", "Store", "Production"]),
  commonController.createItem,
);
router.get(
  "/item/details/:id",
  tokenVerification(["Purchase", "Store"]),
  commonController.getItemById,
);
router.put(
  "/item/update",
  tokenVerification(["Purchase", "Store", "Production"]),
  commonController.updateItem,
);
router.get(
  "/unit/view",
  tokenVerification(["Purchase", "Store", "Admin",'PrePurchase','Production']),
  commonController.showUnit,
);
router.post(
  "/warehouse/materials/sync",
  commonController.syncRawMaterialsToWarehouses,
);
router.post(
  "/warehouse/:warehouseId/materials/stock/sync",
  commonController.syncWarehouseStock,
);
router.get(
  "/raw-material/export/excel",
  commonController.exportRawMaterialsExcel,
);
router.post(
  "/raw-material/update/unit-conversion-factor",
  commonController.upload.single("file"),
  commonController.updateItemsFromExcel,
);
router.post("/system-order/create", commonController.addSystemOrder);
router.put(
  "/system-order/update/order-quantity",
  commonController.increaseOrDecreaseSystemOrder,
);
router.post(
  "/warehouse/raw-material/stock/update",
  commonController.upload.single("file"),
  commonController.updateWarehouseStockByExcel,
);

router.get(
  "/countries",
  tokenVerification(["Purchase",'PrePurchase','Production']),
  commonController.getCountries,
);

router.get(
  "/currency/:country",
  tokenVerification(["Purchase",'Production']),
  commonController.getCurrencyByCountry,
);

router.get(
  "/currencies",
  tokenVerification(["Purchase",'PrePurchase','Production']),
  commonController.getCurrencies,
);

router.get(
  "/address/pincode/:pincode",
  tokenVerification(["Purchase",'PrePurchase','Production']),
  commonController.getAddressByPincode,
);

router.get(
  "/raw-material/stock",
  commonController.exportRawMaterialStockByWarehouse,
);

router.get(
  "/vendors/invoices",
  tokenVerification(["Purchase", "Verification", "Admin", "Accounts"]),
  purchaseOrderController.getVendorPOInvoices,
);

router.post(
  "/raw-material/excel-upload",
  tokenVerification(["Purchase"]),
  commonController.upload.single("file"),
  commonController.bulkUploadRawMaterial,
);

router.post(
  "/item/bulk-upload",
  tokenVerification(["Purchase", "Store", "Production"]),
  commonController.upload.single("file"),
  commonController.bulkUploadItems,
);

router.get("/model/show", commonController.showModels);

router.get(
  "/download/stock/shortage-report",
  tokenVerification(["Purchase"]),
  commonController.downloadSystemStockShortageReport,
);

router.get("/export/po", commonController.exportPOExcel);


// ------------------------- Version 2 API --------------------------//
router.post(
  "/item/create2",
  tokenVerification(["Purchase", "Store"]),
  commonController.createItem2,
);

router.put(
  "/item/update2",
  tokenVerification(["Purchase", "Store"]),
  commonController.updateItem2,
);

router.get("/vendors/order", commonController.getAllVendorsSummary);
router.post("/purchase-orders/follow-up", tokenVerification(["Production"]), commonController.addPurchaseFollowUp);
router.get("/purchase-orders/:poId/follow-ups", tokenVerification(["Admin", "Purchase", "Production"]), commonController.getPurchaseOrderWithFollowUps);
router.get("/stock/shortage", commonController.getInstallationShortageData);

router.get("/item/price/comparison", commonController.getPriceComparison);
router.get("/item/price/cheapest", commonController.getCheapestPrice);
router.get("/payments/dashboard", commonController.getAdvancePaymentDashboard);
router.get("/payments/advance/unsettled", commonController.getAdvancePaymentWithoutMaterial);
router.get("/purchase-orders/receiving/report", commonController.exportPOReceivingReport);
router.post("/uploadFile",  multerUpload(`directIssueItem`, [{ name: "file", maxCount: 1 }]), commonController.uploadFile);
module.exports = router;
