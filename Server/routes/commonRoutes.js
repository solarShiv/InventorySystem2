const {updateLatitudeLongitude, addServicePersonState} = require("../controllers/serviceControllers/servicePersonController");
const {addIsActiveField} = require("../controllers/serviceControllers/authController");
const {deductFromDefectiveOfItems} = require("../controllers/serviceControllers/warehouseController");
const {generateJoiningFormPDF} = require("../helpers/pdf/generateJoiningFormPDF");
const {generateIncomingItemsPDF} = require("../helpers/pdf/generateIncomingItemsPDF");
const {servicePersonRepairedHoldingItemsPDF} = require("../helpers/pdf/servicePersonRepairedItemsAccount");
const {generateWarehouseTransactionPDF} = require("../helpers/pdf/generateWarehouseTransactionPDF");
const {generateServicePersonTransactionPDF} = require("../helpers/pdf/generateServiceTransactionPDF");
const {getSpecificWarehouseStockReportPDF, generateAllWarehouseStockReportPDF} = require("../helpers/pdf/generateWarehouseStockReport");
const {generateItemRepairRejectPDF} = require("../helpers/pdf/generateItemRepairRejectPDF");
const {deleteAllReports} = require("../helpers/pdf/deleteReport");
const {downloadActiveServicePersonsExcel} = require("../helpers/pdf/generateServicePersonData");
const {generateDailyInDefectiveItems} = require("../helpers/pdf/generateSPDefectiveItemsToW");
const {exportToExcel} = require("../helpers/pdf/generateMHReport");
const {generateBhiwaniInDefectiveItems} = require("../helpers/pdf/generateInDefectiveItemsOfBhiwani");
const {generateOverallReportPDF, generateDailyReportPDF, generateDistanceReportPDF} = require("../helpers/pdf/generateReportPDF");
const {generateBhiwaniDailyReport} = require("../helpers/pdf/generateBhiwaniDailyReport");
const {generateBhiwaniDailyInOutReport} = require("../helpers/pdf/generateBhiwaniDailyInOutReport");
const {getSpecificWarehouseOverallReport} = require("../helpers/pdf/generateOverallBhiwaniDefectiveReport");
const {generateWarehouseExcel} = require("../helpers/pdf/generateItemsList");
const {exportIncomingPickupItemsToExcel, exportIncomingTotalItemsToExcel, uploadExcelAndUpdatePickupItems} = require("../controllers/serviceControllers/pickupItemController");
const {generateWToWExcel} = require("../helpers/excelReports/warehouse2WarehouseReport");
const {generateWarehouse2FarmerExcel} = require("../helpers/excelReports/warehouse2FarmerReport");
const {exportPickupItemsToExcel} = require("../helpers/pdf/generateInOutItemsReport");
const router = require("express").Router();
const multer = require("multer");
const { excelToJSON , excelToJSFile, addStateFieldToOldDocuments} = require("../controllers/serviceControllers/test.controller");
const commonController = require("../controllers/commonModelController/commonController");
const systemInstallationReport = require("../helpers/pdf/systemInstallationReport");
const warehouseReports = require("../helpers/pdf/warehouseInOutReport");
const storage = multer.memoryStorage();
const installationInventoryReport = require("../helpers/pdf/installationInventoryReport");
const installationDataController = require("../controllers/serviceControllers/installationDataController");
const {
    getPumpDataBySystem
} = require("../controllers/serviceControllers/warehouseController");
const upload = multer({ storage });

router.put("/upload-excel", upload.single('file'), updateLatitudeLongitude);
router.put("/uploadState", upload.single('file'), addServicePersonState);
router.put("/update-status", upload.single('file'), uploadExcelAndUpdatePickupItems);
router.put("/add-isActive-field", addIsActiveField);
router.get("/generate-pdf", generateJoiningFormPDF);
router.post("/overall-report-pdf", generateOverallReportPDF);
router.post("/daily-report-pdf", generateDailyReportPDF);
router.post("/distance-report-pdf", generateDistanceReportPDF);
router.get("/export-pickUpItems-excel", exportIncomingPickupItemsToExcel);
router.get("/export-incoming-items-excel", exportIncomingTotalItemsToExcel);
router.get("/export-incomingItems-pdf", generateIncomingItemsPDF); //PDF for items remaining in the service person account
router.get("/export-outgoingItems-pdf", servicePersonRepairedHoldingItemsPDF);
router.get("/export-warehouseOutgoing-pdf", generateWarehouseTransactionPDF);  //PDF for outgoing items from warehouse
router.get("/export-warehouseIncoming-pdf", generateServicePersonTransactionPDF); //PDF for incoming items to warehouse
router.get("/export-warehouseStock-pdf", getSpecificWarehouseStockReportPDF);  //PDf for specific warehouse stock
router.get("/export-allWarehouseStock-pdf", generateAllWarehouseStockReportPDF); //PDF for all warehouse stock
router.get("/export-itemRepairReject-pdf", generateItemRepairRejectPDF); //PDF for Item Repair & Reject 
router.get("/export-dailyDefectiveItems-pdf", generateDailyInDefectiveItems);
router.get("/delete-reports", deleteAllReports); //PDF Delete from Server
router.get("/service-person-data", downloadActiveServicePersonsExcel);
router.get("/get-mh-report", exportToExcel);
router.post("/update-item-defective", deductFromDefectiveOfItems);
router.get("/export-monthly-bhiwani-report", generateBhiwaniInDefectiveItems);
router.get("/export-daily-bhiwani-report", generateBhiwaniDailyReport);
router.get("/export-daily-bhiwani-inout-report", generateBhiwaniDailyInOutReport);
router.get("/export-warehouse-defective-report", getSpecificWarehouseOverallReport); //PDF for specific warehouse overall defective report
router.get("/export-bhiwani-items-report", generateWarehouseExcel);
router.get("/export-w2w-report", generateWToWExcel);
router.get("/export-w2f-report", generateWarehouse2FarmerExcel);
//router.get("/overall-hisar-report", generateHisarOverallReport);

router.post("/export-excel", upload.single('file'), excelToJSFile);
router.put("/addStateFieldToOldDocuments", addStateFieldToOldDocuments);
router.get("/exportPickupItemsToExcel", exportPickupItemsToExcel);  

router.post("/createAppVersion", commonController.createAppVersion);
router.get("/installationInventoryStockReport", systemInstallationReport.installationInventoryStockReport);
router.get("/systemSetReport", systemInstallationReport.systemSetReport);
router.get("/generateJalnaReport", warehouseReports.generateJalnaReport)
router.post("/updateInstallationInventory", upload.single('file'), commonController.updateInstallationInventoryFromExcel);
router.post("/import-system-orders", upload.single('file'), commonController.importSystemOrdersFromExcel);
router.get("/systemInventoryReport", installationInventoryReport); // Badnapur Inventory Stock Report - Anirudh Sir

router.post("/add-stage", installationDataController.addStage);
router.get("/show-stages", installationDataController.getAllStages);
router.post("/add-remark", installationDataController.addRemark);
router.get("/show-remarks", installationDataController.getAllRemarks);
router.get("/pump-data", getPumpDataBySystem);
router.get("/approved-installation-excel", installationDataController.exportVT2ApprovedExcel);
router.get("/installed-system-excel", installationDataController.exportInstalledSystemExcel);
router.post("/installation-stage-update", upload.single('file'), installationDataController.bulkUpdateStageFromExcel);


// container 
router.post("/container", commonController.createContainer);
router.get("/container", commonController.getAllContainers);


module.exports = router;
