const express = require("express");
const router = express.Router();
const storekeeperController = require("../../controllers/rawMaterialItemsController/storekeeperController");
const {
  tokenVerification,
} = require("../../middlewares/rawMaterialMiddlewares/tokenVerification");
const uploadHandler = require("../../middlewares/rawMaterialMiddlewares/multerConfigRawItems");
const uploadPurchaseOrderBill = require("../../middlewares/rawMaterialMiddlewares/multerConfigPurchase");

router.get(
  "/getLineWorkerList",
  tokenVerification(["Store", "Production"]),
  storekeeperController.getLineWorkerList,
);

router.get(
  "/getLineWorkerList2",
  tokenVerification(["Store"]),
  storekeeperController.getLineWorkerList2,
);

router.get(
  "/showIncomingItemRequest",
  tokenVerification(["Store"]),
  storekeeperController.showIncomingItemRequest,
);

router.put(
  "/approveOrDeclineItemRequest",
  tokenVerification(["Store"]),
  storekeeperController.approveOrDeclineItemRequest,
);

router.post(
  "/sanctionItemForRequest",
  tokenVerification(["Store"]),
  storekeeperController.sanctionItemForRequest,
);

router.post(
  "/sanctionItemForRequest2",
  tokenVerification(["Store"]),
  storekeeperController.sanctionItemForRequest2,
);

router.get(
  "/getUserItemStock",
  tokenVerification(["Store", "Production"]),
  storekeeperController.getUserItemStock,
);

router.get(
  "/getUserItemStockDetails",
  tokenVerification(["Store"]),
  storekeeperController.getUserItemStockDetails,
);

router.post(
  "/updateStock",
  tokenVerification(["Store"]),
  uploadHandler,
  storekeeperController.updateStock,
);

router.post(
  "/updateStock2",
  tokenVerification(["Store"]),
  uploadHandler,
  storekeeperController.updateStock2,
);

router.get(
  "/showProcessData",
  tokenVerification(["Store", "Production", "Admin"]),
  storekeeperController.showProcessData,
);

router.get(
  "/showProcessData2",
  tokenVerification(["Store"]),
  storekeeperController.showProcessData2,
);

router.get(
  "/getRawMaterialList",
  tokenVerification(["Store", "Purchase"]),
  storekeeperController.getRawMaterialList,
);

router.get(
  "/getWarehouseRawMaterialList",
  tokenVerification(["Store"]),
  storekeeperController.getWarehouseRawMaterialList,
);

router.get(
  "/getStockMovementHistory",
  tokenVerification(["Store"]),
  storekeeperController.getStockMovementHistory,
);

router.get(
  "/getStockMovementHistory2",
  tokenVerification(["Store"]),
  storekeeperController.getStockMovementHistory2,
);

router.put(
  "/markRawMaterialUsedOrNotUsed",
  tokenVerification(["Store", "Purchase"]),
  storekeeperController.markRawMaterialUsedOrNotUsed,
);

router.put(
  "/markSystemItemUsedOrNotUsed",
  tokenVerification(["Purchase", "Store"]),
  storekeeperController.markSystemItemUsedOrNotUsed,
);

router.get(
  "/getPendingPOsForReceiving",
  tokenVerification(["Store"]),
  storekeeperController.getPendingPOsForReceiving,
);

router.post(
  "/purchaseOrder/receive",
  tokenVerification(["Store"]),
  uploadPurchaseOrderBill,
  storekeeperController.purchaseOrderReceivingBill,
);

// router.post(
//   "/directItemIssue",
//   tokenVerification(["Store"]),
//   storekeeperController.directItemIssue
// );

router.post(
  "/directItemIssue",
  tokenVerification(["Store"]),
  storekeeperController.newDirectItemIssue,
);

router.get(
  "/directItemIssue/history",
  tokenVerification(["Store", "Production"]),
  storekeeperController.getDirectItemIssueHistory,
);

router.get(
  "/returnMaterial/outstanding",
  tokenVerification(["Store"]),
  storekeeperController.getOutstandingReturnableMaterials,
);

router.post(
  "/returnMaterial",
  tokenVerification(["Store"]),
  storekeeperController.returnMaterial,
);

router.post(
  "/addItemContainerStock",
  tokenVerification(["Store"]),
  storekeeperController.addItemContainerStock,
);

module.exports = router;
