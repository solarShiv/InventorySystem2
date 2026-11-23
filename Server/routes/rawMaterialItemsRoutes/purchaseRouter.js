const express = require("express");
const router = express.Router();
const purchaseOrderController = require("../../controllers/rawMaterialItemsController/purchaseOrderController");
const {
  tokenVerification,
} = require("../../middlewares/rawMaterialMiddlewares/tokenVerification");
const uploadDebitNoteBill = require("../../middlewares/rawMaterialMiddlewares/multerConfigDebitNote");
const uploadVendorDocs = require("../../middlewares/rawMaterialMiddlewares/multerConfigVendor");

router.post(
  "/companies",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createCompany,
);

router.post(
  "/vendors",
  tokenVerification(["Purchase", "Admin",'PrePurchase','Production']),
  uploadVendorDocs.fields([
    { name: "aadhaarFile", maxCount: 1 },
    { name: "pancardFile", maxCount: 1 },
    { name: "bgDocumentFile", maxCount: 1 },
    { name: "balanceSheetFile", maxCount: 1 },
  ]),
  purchaseOrderController.createVendor,
);

router.get(
  "/companies",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getCompaniesList,
);

router.get(
  "/companies/data",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getCompaniesData,
);

router.get(
  "/vendors",
  // tokenVerification(["Purchase", "Admin",'PrePurchase','Production']),
  purchaseOrderController.getVendorsList,
);

router.get(
  "/vendors/data",
  tokenVerification(["Purchase", "Admin",'PrePurchase','Production']),
  purchaseOrderController.getVendorsData,
);

router.get(
  "/companies/:id",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getCompanyById,
);

router.get(
  "/vendors/:id",
  tokenVerification(["Purchase", "Admin",'PrePurchase','Production']),
  purchaseOrderController.getVendorById,
);

router.put(
  "/companies/:id",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.updateCompany,
);

router.put(
  "/vendors/:id",
  tokenVerification(["Purchase", "Admin"]),
  uploadVendorDocs.fields([
    { name: "aadhaarFile", maxCount: 1 },
    { name: "pancardFile", maxCount: 1 },
    { name: "bgDocumentFile", maxCount: 1 },
    { name: "balanceSheetFile", maxCount: 1 },
  ]),
  purchaseOrderController.updateVendor,
);

router.get(
  "/items",
  tokenVerification(["Purchase", "Admin",'PrePurchase','Production']),
  purchaseOrderController.getItemsList,
);

router.get(
  "/items/details/:id",
  tokenVerification(["Purchase", "Admin","PrePurchase",'Production']),
  purchaseOrderController.getItemDetails,
);

router.post(
  "/purchase-orders/create",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createPurchaseOrder,
);

router.post(
  "/purchase-orders/create2",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createPurchaseOrder2,
);

router.get(
  "/purchase-orders/show",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getPOList,
);

router.get(
  "/purchase-orders/company/:companyId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getPOListByCompany2,
);

router.get(
  "/purchase-orders/details/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getPurchaseOrderDetails,
);

router.put(
  "/purchase-orders/update/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.updatePurchaseOrder,
);

router.put(
  "/purchase-orders/update2/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.updatePurchaseOrderController,
);

router.post(
  "/purchase-orders/download/:poId",
  tokenVerification(["Purchase", "Admin", "Production"]),
  purchaseOrderController.downloadPOPDF,
);

router.post(
  "/purchase-orders/download2/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.downloadPOPDF2,
);

router.get(
  "/dashboard",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getPODashboard,
);

router.get(
  "/warehouses",
  tokenVerification(["Purchase", "Admin", "Production", "Store"]),
  purchaseOrderController.getWarehouses,
);

router.get(
  "/systems",
  tokenVerification(["Purchase", "Admin", "Production", "Store"]),
  purchaseOrderController.getSystems,
);

router.put(
  "/purchase-orders/cancel/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.cancelPurchaseOrder,
);

//------------ Debit Note Section --------------

router.get(
  "/purchase-orders/damaged-stock/details/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getPurchaseOrderDetailsWithDamagedItems,
);

router.post(
  "/debit-note/create",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createDebitNote,
);

router.get(
  "/:poId/debit-note",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getDebitNoteListByPO,
);

router.post(
  "/:poId/debit-note/download/:debitNoteId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.downloadDebitNote,
);

router.get(
  "/debit-note/details/:debitNoteId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getDebitNoteDetails,
);

router.put(
  "/debit-note/update/:debitNoteId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.updateDebitNote,
);

router.post(
  "/debit-note/receive",
  tokenVerification(["Purchase", "Admin"]),
  uploadDebitNoteBill,
  purchaseOrderController.debitNoteReceivingBill,
);

router.get(
  "/dashboard/warehouses/:warehouseId/systems/:systemId/orders",
  tokenVerification(["Purchase", "Store", "Admin", "Production", "Store"]),
  purchaseOrderController.getSystemDashboardData,
);

router.get(
  "/warehouses/raw-material",
  tokenVerification(["Purchase", "Store", "Admin", "Production"]),
  purchaseOrderController.getRawMaterialByWarehouse,
);

//-----------------Version V2 ------------------//

router.get(
  "/dashboard2",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getPODashboard2,
);

router.post(
  "/vendors2",
  tokenVerification(["Purchase", "Admin"]),
  uploadVendorDocs.fields([
    { name: "aadhaarFile", maxCount: 1 },
    { name: "pancardFile", maxCount: 1 },
  ]),
  purchaseOrderController.createVendor2,
);

router.get(
  "/vendors2/:id",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getVendorById2,
);

router.put(
  "/vendors2/:id",
  tokenVerification(["Purchase", "Admin"]),
  uploadVendorDocs.fields([
    { name: "aadhaarFile", maxCount: 1 },
    { name: "pancardFile", maxCount: 1 },
  ]),
  purchaseOrderController.updateVendor2,
);

//------------------- Payment Routes --------------------//

router.get(
  "/purchase-orders/payments/pending",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.showPendingPayments,
);

router.post(
  "/purchase-orders/payments/request",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createPaymentRequest,
);

router.get(
  "/purchase-orders/payments/show",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.showAllPaymentRequests,
);

router.put(
  "/purchase-orders/payments/reject",
  tokenVerification(["Purchase"]),
  purchaseOrderController.rejectPaymentRequest,
);

router.post(
  "/purchase-orders/send/:poId",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.sendPOToVendor,
);

router.get(
  "/purchase-orders/receiving",
  tokenVerification(["Purchase", "Production", "Admin"]),
  purchaseOrderController.getPOsReceivings,
);

router.post(
  "/warehouses/create",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createWarehouse,
);

router.post(
  "/units/create",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createUnit,
);

router.post(
  "/vendor/invoices/upload",
  tokenVerification(["Purchase", "Admin"]),
  uploadVendorDocs.fields([{ name: "invoiceFile", maxCount: 1 }]),
  purchaseOrderController.uploadVendorInvoice,
);

router.put(
  "/purchase-orders/:poId/send-for-approval",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.sendPOForApproval,
);

router.post(
  "/model/create",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.addBOMModel,
);

router.get("/vendor/template", purchaseOrderController.downloadVendorTemplate);

//------------------------- Version 2 API --------------------------//

router.post(
  "/import/terms",
  tokenVerification(["Purchase"]),
  purchaseOrderController.upload.single("file"),
  purchaseOrderController.uploadTermsFromExcel,
);

router.get(
  "/terms",
  tokenVerification(["Purchase"]),
  purchaseOrderController.getAllTerms,
);

router.get(
  "/items2",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getItemsList2,
);

router.get(
  "/items/details2/:id",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.getItemDetails2,
);

router.post(
  "/purchase-orders/create3",
  tokenVerification(["Purchase", "Admin"]),
  purchaseOrderController.createPurchaseOrder3,
);

router.post(
  "/purchase-orders/payments/request3",
  tokenVerification(["Purchase"]),
  purchaseOrderController.createPaymentRequest3,
);


module.exports = router;
