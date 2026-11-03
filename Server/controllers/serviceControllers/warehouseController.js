const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const axios = require("axios");
const mongoose = require("mongoose");
const XLSX = require("xlsx");
const prisma = require("../../config/prismaClient");
const Warehouse = require("../../models/serviceInventoryModels/warehouseSchema");
const WarehousePerson = require("../../models/serviceInventoryModels/warehousePersonSchema");
const WarehouseItems = require("../../models/serviceInventoryModels/warehouseItemsSchema");
const ServicePerson = require("../../models/serviceInventoryModels/servicePersonSchema");
const SurveyPerson = require("../../models/serviceInventoryModels/surveyPersonSchema");
const RepairNRejectItems = require("../../models/serviceInventoryModels/repairNRejectSchema");
const PickupItem = require("../../models/serviceInventoryModels/pickupItemSchema");
const System = require("../../models/systemInventoryModels/systemSchema");
const SystemItem = require("../../models/systemInventoryModels/systemItemSchema");
const SystemItemMap = require("../../models/systemInventoryModels/systemItemMapSchema");
const ItemComponentMap = require("../../models/systemInventoryModels/itemComponentMapSchema");
const SystemInventoryWToW = require("../../models/systemInventoryModels/systemItemsWToWSchema");
const InstallationInventory = require("../../models/systemInventoryModels/installationInventorySchema");
const FarmerItemsActivity = require("../../models/systemInventoryModels/farmerItemsActivity");
const InstallationAssignEmp = require("../../models/systemInventoryModels/installationAssignEmpSchema");
const IncomingItemsAccount = require("../../models/systemInventoryModels/incomingNewSystemItems");
const NewSystemInstallation = require("../../models/systemInventoryModels/newSystemInstallationSchema");
const StockUpdateActivity = require("../../models/systemInventoryModels/stockUpdateActivity");
const StockHistory = require("../../models/serviceInventoryModels/stockHistorySchema");
const OutgoingItems = require("../../models/serviceInventoryModels/outgoingItems");
const SerialNumber = require("../../models/systemInventoryModels/serialNumberSchema");
const DispatchDetails = require("../../models/systemInventoryModels/dispatchDetailsSchema");
const DispatchBillPhoto = require("../../models/systemInventoryModels/dispatchBillPhotoSchema");
const ReceivingItems = require("../../models/serviceInventoryModels/receivingItemsSchema");
const FarmerReplacementItemsActivity = require("../../models/systemInventoryModels/farmerReplacementItemsActivity");
const ReplacementDispatchDetails = require("../../models/systemInventoryModels/replacementDispatchDetailsSchema");
const ReplacementDispatchBillPhoto = require("../../models/systemInventoryModels/replacementDispatchBillSchema");
const MaterialDispatchLog = require("../../models/systemInventoryModels/materialDispatchLog");
const Item = require("../../models/serviceInventoryModels/itemSchema");
const DispatchSerialNumbers = require("../../models/systemInventoryModels/dispatchedSerialNumbers");
const SystemOrder = require("../../models/systemInventoryModels/systemOrderSchema");
const BOM = require("../../models/systemInventoryModels/bomModelSchema");
const apiRequest = require("../../util/apiRequest");
//****************** Admin Access ******************//

module.exports.addWarehouse = async (req, res) => {
  const { warehouseName } = req.body;
  const createdBy = req.user?.id;

  if (!warehouseName) {
    return res.status(400).json({
      success: false,
      message: "Warehouse name is required",
    });
  }

  try {
    // ---------- CHECK EXISTING ----------
    const trimmedWarehouseName = warehouseName.trim();
    const existingWarehouse = await Warehouse.findOne({
      warehouseName: trimmedWarehouseName,
    });

    if (existingWarehouse) {
      return res.status(400).json({
        success: false,
        message: "Warehouse already exists",
      });
    }

    // ---------- CREATE WAREHOUSE ----------
    const savedWarehouse = await new Warehouse({
      warehouseName: trimmedWarehouseName,
    }).save();

    const warehouseId = savedWarehouse._id.toString();

    // ======================================================
    // 1️⃣ RAW MATERIAL → WAREHOUSE STOCK (MYSQL) [FAST]
    // ======================================================

    const [rawMaterials, existingStocks] = await Promise.all([
      prisma.rawMaterial.findMany({
        select: { id: true, unit: true, isUsed: true },
      }),
      prisma.warehouseStock.findMany({
        where: { warehouseId },
        select: { id: true, rawMaterialId: true, isUsed: true },
      }),
    ]);

    const stockMap = new Map();
    existingStocks.forEach((s) => {
      stockMap.set(s.rawMaterialId, s);
    });

    const createData = [];
    const updatePromises = [];

    for (const rm of rawMaterials) {
      const stock = stockMap.get(rm.id);

      if (!stock) {
        // 🆕 create missing
        createData.push({
          warehouseId,
          rawMaterialId: rm.id,
          quantity: 0,
          unit: rm.unit,
          isUsed: rm.isUsed,
        });
      } else if (stock.isUsed !== rm.isUsed) {
        // 🔁 update ONLY isUsed
        updatePromises.push(
          prisma.warehouseStock.update({
            where: { id: stock.id },
            data: { isUsed: rm.isUsed },
          }),
        );
      }
    }

    if (createData.length) {
      await prisma.warehouseStock.createMany({
        data: createData,
        skipDuplicates: true,
      });
    }

    if (updatePromises.length) {
      await Promise.all(updatePromises);
    }

    // ======================================================
    // 2️⃣ SYSTEM ITEM → INSTALLATION INVENTORY (MONGODB)
    // ======================================================
    const systemItems = await SystemItem.find({}, { _id: 1 });

    if (systemItems.length) {
      await InstallationInventory.insertMany(
        systemItems.map((item) => ({
          warehouseId: savedWarehouse._id,
          systemItemId: item._id,
          quantity: 0,
          createdBy,
        })),
        { ordered: false },
      );
    }

    return res.status(200).json({
      success: true,
      message: "Warehouse added and inventories initialized",
      data: savedWarehouse,
    });
  } catch (error) {
    console.error("Add Warehouse Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showWarehouses = async (req, res) => {
  try {
    const allWarehouses = await Warehouse.find({
      warehouseName: { $nin: ["Sirsa", "Hisar", "Jind", "Fatehabad"] },
    }).select("-__v -createdAt");

    if (allWarehouses.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Warehouses Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      allWarehouses,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.viewWarehousePersons = async (req, res) => {
  try {
    const allWarehousePersons = await WarehousePerson.find()
      .populate("warehouse", "-_id -__v -createdAt")
      .select("-password -role -createdAt -refreshToken -__v");
    if (!allWarehousePersons) {
      return res.status(404).json({
        success: false,
        message: "Warehouse Persons Data Not Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      allWarehousePersons,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.viewServicePersons = async (req, res) => {
  try {
    const allServicePersons = await ServicePerson.find().select(
      "-password -role -createdAt -refreshToken -__v",
    );
    if (!allServicePersons) {
      return res.status(404).json({
        success: false,
        message: "Service Persons Data Not Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      allServicePersons,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.deactivateWarehousePerson = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID is required",
      });
    }

    const warehousePerson = await WarehousePerson.findById(id);
    warehousePerson.isActive = false;
    await warehousePerson.save();
    return res.status(200).json({
      success: true,
      message: "Warehouse Person Deactivated Successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.deactivateServicePerson = async (req, res) => {
  try {
    const { id, status } = req.query;
    if (!id || status === undefined) {
      return res.status(400).json({
        success: false,
        message: "ID and status are required",
      });
    }

    const servicePerson = await ServicePerson.findById(id);
    if (!servicePerson) {
      return res.status(400).json({
        success: false,
        message: "Please enter the valid Id",
      });
    }
    servicePerson.isActive = status;
    await servicePerson.save();
    return res.status(200).json({
      success: true,
      message: status
        ? "Service Person Activated Successfully"
        : "Service Person Deactivated Successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showStockUpdateHistory = async (req, res) => {
  try {
    const allStockUpdateHistory = await StockHistory.find()
      .populate("empId", "name")
      .populate("warehouseId", "warehouseName")
      .select("-_id -__v")
      .sort({ createdAt: -1 });

    if (!allStockUpdateHistory) {
      return res.status(404).json({
        success: false,
        message: "Stock Update History Not Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: allStockUpdateHistory,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.allRepairRejectItemsData = async (req, res) => {
  try {
    const allRepairRejectData = await RepairNRejectItems.find({}).sort({
      createdAt: -1,
    });
    if (!allRepairRejectData) {
      return res.status(404).json({
        success: false,
        message: "RepairReject Item Data Not Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      allRepairRejectData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

//***************** Warehouse Access *******************//

module.exports.showItems = async (req, res) => {
  try {
    const itemsData = await Items;
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addWarehouseItems = async (req, res) => {
  try {
    // Extract items from the request body
    const { items, defective, repaired, rejected } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items are required and should be a non-empty array",
      });
    }

    // Validate and sanitize the items in req.body
    for (const newItem of items) {
      if (!newItem.itemName || typeof newItem.itemName !== "string") {
        return res.status(400).json({
          success: false,
          message: "Each item must have a valid itemName",
        });
      }

      // Ensure itemName is trimmed
      newItem.itemName = newItem.itemName.trim();

      // Check if quantity is provided and is zero
      if (!newItem.quantity || newItem.quantity !== 0) {
        newItem.quantity = 0; // Set to zero if not provided or invalid
      }
    }

    // Update/Create items in the Item collection
    for (const newItem of items) {
      let itemRecord = await Item.findOne({ itemName: newItem.itemName });

      if (itemRecord) {
        itemRecord.stock += newItem.quantity;
        itemRecord.updatedAt = Date.now();
        await itemRecord.save();
      } else {
        itemRecord = new Item({
          itemName: newItem.itemName,
          stock: newItem.quantity,
          defective,
          repaired,
          rejected,
        });
        await itemRecord.save();
      }
    }

    // Fetch all warehouses
    const allWarehouses = await Warehouse.find();

    // Update the warehouseItems for each warehouse
    for (const warehouse of allWarehouses) {
      let warehouseItemsRecord = await WarehouseItems.findOne({
        warehouse: warehouse._id,
      });

      if (!warehouseItemsRecord) {
        warehouseItemsRecord = new WarehouseItems({
          warehouse: warehouse._id,
          items: [],
        });
      }

      for (const newItem of items) {
        const existingItem = warehouseItemsRecord.items.find(
          (item) => item.itemName === newItem.itemName,
        );

        if (!existingItem) {
          // Add the item with quantity set to zero
          warehouseItemsRecord.items.push({
            itemName: newItem.itemName,
            quantity: newItem.quantity,
            newStock: 0, // Will always be zero at this point
          });
        }
        // If the item already exists, leave the quantity unchanged
      }

      await warehouseItemsRecord.save();
    }

    return res.status(200).json({
      success: true,
      message: "Items successfully added to all warehouses", //with quantity validated and set to zero where needed
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addWarehouseItemsStock = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const empId = req.user._id;
    const { items, defective } = req.body;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "warehouseID not found",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items are required and should be a non-empty array",
      });
    }

    let warehouseItemsRecord = await WarehouseItems.findOne({
      warehouse: warehouseId,
    });

    for (const newItem of items) {
      let itemName = newItem.itemName.trim();

      const existingItem = warehouseItemsRecord.items.find(
        (item) =>
          item.itemName.toLowerCase().trim() === itemName.toLowerCase().trim(),
      );

      if (!existingItem) {
        return res.status(400).json({
          success: false,
          message: "Item Doesn't Exists In Warehouse",
        });
      } else {
        existingItem.newStock =
          parseInt(existingItem.newStock) + parseInt(newItem.newStock);
        existingItem.quantity =
          parseInt(existingItem.quantity) + parseInt(newItem.quantity);
        existingItem.defective =
          parseInt(existingItem.defective) + parseInt(defective);

        const stockHistory = new StockHistory({
          empId,
          warehouseId,
          itemName: existingItem.itemName,
          newStock: newItem.newStock,
          quantity: newItem.quantity,
          defective: defective,
        });
        await stockHistory.save();
      }
    }
    await warehouseItemsRecord.save();

    return res.status(200).json({
      success: true,
      message: "Items stock added successfully",
      warehouseItemsRecord,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.viewWarehouseItems = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(404).json({
        success: false,
        message: "WarehouseId not found",
      });
    }

    const warehouseItems = await WarehouseItems.findOne({
      warehouse: warehouseId,
    });
    if (!warehouseItems) {
      return res.status(404).json({
        success: false,
        message: "Warehouse Items Not Found",
      });
    }

    let items = [];
    for (let item of warehouseItems.items) {
      items.push(item.itemName);
    }

    return res.status(200).json({
      success: true,
      message: "Warehouse Items Fetched Successfully",
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.warehouseDashboard = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "warehouseId not found",
      });
    }

    const warehouseData = await WarehouseItems.findOne({
      warehouse: warehouseId,
    }).populate("warehouse", "warehouseName -_id");
    if (!warehouseData) {
      return res.status(404).json({
        success: false,
        message: "Warehouse Data Not Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      warehouseData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.repairItemData = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const personName = req.user.name;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseID not found",
      });
    }
    const {
      itemName,
      serialNumber,
      repaired,
      repairedBy,
      remark,
      createdAt,
      changeMaterial,
    } = req.body;

    if (
      !itemName ||
      !repaired ||
      !serialNumber ||
      !remark ||
      !repairedBy ||
      !createdAt ||
      !changeMaterial
    ) {
      return res.status(400).json({
        success: false,
        message: "itemName is required",
      });
    }

    // const itemRecord = await Item.findOne({ itemName });
    // if (!itemRecord) {
    //     return res.status(404).json({
    //         success: false,
    //         message: "Item Not Found In ItemSchema"
    //     });
    // }

    const warehouseItemsRecord = await WarehouseItems.findOne({
      warehouse: warehouseId,
    }).populate("warehouse", "-__v -createdAt");
    if (!warehouseItemsRecord) {
      return res.status(404).json({
        success: false,
        message: "WarehouseItemsRecord Not Found",
      });
    }
    const warehouseName = warehouseItemsRecord.warehouse.warehouseName;

    const warehouseItem = warehouseItemsRecord.items.find(
      (item) => item.itemName === itemName,
    );
    if (!warehouseItem) {
      return res.status(404).json({
        success: false,
        message: "Item Not Found In Warehouse",
      });
    }

    if (parseInt(repaired)) {
      //Adjusting Warehouse Items Quantity, Defective, Repaired Field in WarehouseItems Schema
      if (
        warehouseItem.defective !== 0 &&
        warehouseItem.defective >= parseInt(repaired)
      ) {
        warehouseItem.defective =
          parseInt(warehouseItem.defective) - parseInt(repaired);
        warehouseItem.quantity =
          parseInt(warehouseItem.quantity) + parseInt(repaired);
        warehouseItem.repaired =
          parseInt(warehouseItem.repaired) + parseInt(repaired);
      } else {
        return res.status(403).json({
          success: false,
          message: "Defective is less than repaired. Cannot be updated",
        });
      }

      //Adjusting Items Stock, Defective, Repaired Field in ItemSchema
      // if (itemRecord.defective !== 0 && itemRecord.defective >= (parseInt(repaired))) {
      //     itemRecord.defective = parseInt(itemRecord.defective) - parseInt(repaired);
      //     itemRecord.stock = parseInt(itemRecord.stock) + parseInt(repaired);
      //     itemRecord.repaired = parseInt(itemRecord.repaired) + parseInt(repaired);
      // } else {
      //     return res.status(403).json({
      //         success: false,
      //         message: "Defective is less than repaired. Cannot be updated"
      //     })
      // }
    }

    // if(parseInt(rejected)){
    //     //Adjusting Warehouse Items Defective and Rejected Field in WarehouseItems Schema
    //     if(warehouseItem.defective !== 0 && warehouseItem.defective >= (parseInt(rejected))){
    //         warehouseItem.defective = parseInt(warehouseItem.defective) - parseInt(rejected);
    //         warehouseItem.rejected = parseInt(warehouseItem.rejected) + parseInt(rejected);
    //     }else{
    //         return res.status(403).json({
    //             success: false,
    //             message: "Defective is less than rejected. Cannot be updated"
    //         });
    //     }

    //     //Adjusting Items Defective and Rejected Field in ItemSchema
    //     if(itemRecord.defective !== 0 && itemRecord.defective >= (parseInt(rejected))){
    //         itemRecord.defective = parseInt(itemRecord.defective) - parseInt(rejected);
    //         itemRecord.rejected = parseInt(itemRecord.rejected) + parseInt(rejected);
    //     }else{
    //         return res.status(403).json({
    //             success: false,
    //             message: "Defective is less than rejected. Cannot be updated"
    //         });
    //     }
    // }

    //await itemRecord.save();
    await warehouseItemsRecord.save();

    const repairProductData = new RepairNRejectItems({
      warehouseId: warehouseId,
      warehousePerson: personName,
      warehouseName: warehouseName,
      itemName,
      serialNumber: serialNumber || "",
      isRepaired: true,
      repaired: parseInt(repaired),
      rejected: 0,
      repairedBy,
      remark: remark || "",
      createdAt,
      changeMaterial,
    });

    await repairProductData.save();

    return res.status(200).json({
      success: true,
      message: "Data Inserted Successfully",
      repairProductData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.rejectItemData = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const personName = req.user.name;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseID not found",
      });
    }

    const { itemName, serialNumber, rejected, remark, createdAt } = req.body;
    if (!itemName || !serialNumber || !remark || !rejected || !createdAt) {
      return res.status(400).json({
        success: false,
        message: "itemName is required",
      });
    }

    // const itemRecord = await Item.findOne({ itemName });
    // if (!itemRecord) {
    //     return res.status(404).json({
    //         success: false,
    //         message: "Item Not Found In ItemSchema"
    //     });
    // }

    const warehouseItemsRecord = await WarehouseItems.findOne({
      warehouse: warehouseId,
    }).populate("warehouse", "-__v -createdAt");
    if (!warehouseItemsRecord) {
      return res.status(404).json({
        success: false,
        message: "WarehouseItemsRecord Not Found",
      });
    }
    const warehouseName = warehouseItemsRecord.warehouse.warehouseName;

    const warehouseItem = warehouseItemsRecord.items.find(
      (item) => item.itemName === itemName,
    );
    if (!warehouseItem) {
      return res.status(404).json({
        success: false,
        message: "Item Not Found In Warehouse",
      });
    }

    // if(parseInt(repaired)){
    //     //Adjusting Warehouse Items Quantity, Defective, Repaired Field in WarehouseItems Schema
    //     if(warehouseItem.defective !== 0 && warehouseItem.defective >= (parseInt(repaired) + parseInt(rejected))){
    //         warehouseItem.defective = parseInt(warehouseItem.defective) - parseInt(repaired);
    //         warehouseItem.quantity = parseInt(warehouseItem.quantity) + parseInt(repaired);
    //         warehouseItem.repaired = parseInt(warehouseItem.repaired) + parseInt(repaired);
    //     }else{
    //         return res.status(403).json({
    //             success: false,
    //             message: "Defective is less than repaired. Cannot be updated"
    //         });
    //     }

    //     //Adjusting Items Stock, Defective, Repaired Field in ItemSchema
    //     if(itemRecord.defective !== 0 && itemRecord.defective >= (parseInt(repaired) + parseInt(rejected))){
    //         itemRecord.defective = parseInt(itemRecord.defective) - parseInt(repaired);
    //         itemRecord.stock = parseInt(itemRecord.stock) + parseInt(repaired);
    //         itemRecord.repaired = parseInt(itemRecord.repaired) + parseInt(repaired);
    //     }else{
    //         return res.status(403).json({
    //             success: false,
    //             message: "Defective is less than repaired. Cannot be updated"
    //         })
    //     }
    // }

    if (parseInt(rejected)) {
      //Adjusting Warehouse Items Defective and Rejected Field in WarehouseItems Schema
      if (
        warehouseItem.defective !== 0 &&
        warehouseItem.defective >= parseInt(rejected)
      ) {
        warehouseItem.defective =
          parseInt(warehouseItem.defective) - parseInt(rejected);
        warehouseItem.rejected =
          parseInt(warehouseItem.rejected) + parseInt(rejected);
      } else {
        return res.status(403).json({
          success: false,
          message: "Defective is less than rejected. Cannot be updated",
        });
      }

      //Adjusting Items Defective and Rejected Field in ItemSchema
      // if (itemRecord.defective !== 0 && itemRecord.defective >= (parseInt(rejected))) {
      //     itemRecord.defective = parseInt(itemRecord.defective) - parseInt(rejected);
      //     itemRecord.rejected = parseInt(itemRecord.rejected) + parseInt(rejected);
      // } else {
      //     return res.status(403).json({
      //         success: false,
      //         message: "Defective is less than rejected. Cannot be updated"
      //     });
      // }
    }

    //await itemRecord.save();
    await warehouseItemsRecord.save();

    const rejectProductData = new RepairNRejectItems({
      warehouseId: warehouseId,
      warehousePerson: personName,
      warehouseName: warehouseName,
      itemName,
      serialNumber: serialNumber || "",
      isRepaired: false,
      repaired: 0,
      rejected: parseInt(rejected),
      repairedBy: null,
      remark: remark || "",
      createdAt,
    });

    await rejectProductData.save();

    return res.status(200).json({
      success: true,
      message: "Data Inserted Successfully",
      newRepairRejectData: rejectProductData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.warehouseRepairItemsData = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseID is required",
      });
    }

    const allRepairItemData = await RepairNRejectItems.find({
      warehouseId: warehouseId,
      isRepaired: true,
    }).sort({ createdAt: -1 });
    // if(!allRepairRejectData){
    //     return res.status(404).json({
    //         success: false,
    //         message: "Data Not Found For The Warehouse"
    //     });
    // }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      allRepairItemData: allRepairItemData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.warehouseRejectItemsData = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseID is required",
      });
    }

    const allRejectItemData = await RepairNRejectItems.find({
      warehouseId: warehouseId,
      isRepaired: false,
    }).sort({ createdAt: -1 });
    // if(!allRepairRejectData){
    //     return res.status(404).json({
    //         success: false,
    //         message: "Data Not Found For The Warehouse"
    //     });
    // }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      allRejectItemData: allRejectItemData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.viewOrdersApprovedHistory = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseId Not Found",
      });
    }

    const warehouseData = await Warehouse.findOne({ _id: warehouseId });
    const warehouseItemsData = await PickupItem.find({
      warehouse: warehouseData.warehouseName,
    })
      .populate("servicePerson", "name contact")
      .sort({ pickupDate: -1 });

    let orderHistory = [];
    for (let order of warehouseItemsData) {
      if (order.status === true) {
        orderHistory.push(order);
      }
    }
    return res.status(200).json({
      success: true,
      message: "History Data Fetched Successfully",
      orderHistory,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.getWarehouse = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseId not found",
      });
    }

    const warehouseData = await Warehouse.findOne({ _id: warehouseId });
    const warehouseName = warehouseData.warehouseName;
    return res.status(200).json({
      success: true,
      message: "Warehouse Fetched Successfully",
      warehouseId,
      warehouseName,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.viewApprovedOrderHistory = async (req, res) => {
  try {
    const servicePersonId = req.user._id;
    if (!servicePersonId) {
      return res.status(400).json({
        success: false,
        message: "servicePersonId not found",
      });
    }

    const pickupItemData = await PickupItem.find({
      servicePerson: servicePersonId,
    }).sort({ pickupDate: -1 });

    let orderHistory = [];

    for (let order of pickupItemData) {
      if (order.incoming === false && order.status === true) {
        orderHistory.push(order);
      }
    }

    return res.status(200).json({
      success: true,
      message: "History Fetched Successfully",
      orderHistory,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

//Installation Controllers For Warehouse
module.exports.addSystem = async (req, res) => {
  try {
    const { systemName } = req.body;
    const empId = req.user._id;
    if (!systemName) {
      return res.status(400).json({
        success: false,
        message: "systemName is required",
      });
    }

    const existingSystem = await System.findOne({ systemName });
    if (existingSystem) {
      return res.status(400).json({
        success: false,
        message: "System Already Exists",
      });
    }

    const newSystem = new System({
      systemName: systemName.trim(),
      createdBy: empId,
    });
    const savedSystem = await newSystem.save();
    if (savedSystem) {
      return res.status(200).json({
        success: true,
        message: "System Data Saved Successfully",
        data: savedSystem,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addSystemItem = async (req, res) => {
  try {
    const { itemName, unit, description, conversionUnit, conversionFactor } =
      req.body;
    const empId = req.user._id;

    if (
      !itemName ||
      !unit ||
      !description ||
      !conversionFactor ||
      !conversionUnit
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Item name, unit, description, conversionUnit, conversionFactor is required",
      });
    }

    const trimmedName = itemName.trim();

    // Check for duplicate
    const existingSystemItem = await SystemItem.findOne({
      itemName: trimmedName,
    });
    if (existingSystemItem) {
      return res.status(400).json({
        success: false,
        message: "Duplicate Data: itemName already exists",
      });
    }

    // Save new system item
    const newSystemItem = new SystemItem({
      itemName: trimmedName,
      unit: unit,
      description: description,
      converionUnit: conversionUnit,
      conversionFactor: conversionFactor,
      createdBy: empId,
    });
    const savedSystemItem = await newSystemItem.save();

    // Add this item to all warehouses' inventories
    const allWarehouses = await Warehouse.find();
    for (let warehouse of allWarehouses) {
      const exists = await InstallationInventory.findOne({
        warehouseId: warehouse._id,
        systemItemId: savedSystemItem._id,
      });

      if (!exists) {
        const newInventory = new InstallationInventory({
          warehouseId: warehouse._id,
          systemItemId: savedSystemItem._id,
          quantity: 0,
          createdBy: empId,
        });
        await newInventory.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "System Item Added and Mapped to All Warehouses Successfully",
      data: savedSystemItem,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addSystemSubItem = async (req, res) => {
  try {
    const { systemId, systemItemId, quantity } = req.body;
    const empId = req.user._id;
    if (!systemId || !systemItemId || !quantity) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const systemItem = await SystemItem.findOne({ _id: systemItemId });
    if (!systemItem) {
      return res.status(404).json({
        success: false,
        message: "SystemItem Not Found",
      });
    }

    const existingSystemSubItem = await SystemSubItem.findOne({
      systemId,
      systemItemId,
      // subItemName: { $regex: new RegExp("^" + subItemName + "$", "i") } // Case-insensitive search
    });
    if (existingSystemSubItem) {
      return res.status(400).json({
        success: false,
        message: "Duplicate Data: With Same systemId, systemItemId ",
        data: existingSystemSubItem,
      });
    }

    const insertSystemSubItem = {
      systemId,
      systemItemId,
      // subItemName: subItemName.trim(),
      quantity,
      createdBy: empId,
    };

    const newSystemSubItem = new SystemSubItem(insertSystemSubItem);
    const savedSystemSubItem = await newSystemSubItem.save();

    // const allWarehouses = await Warehouse.find();
    // //let newInventoryItem, savedInventoryItem;

    // // for (let warehouse of allWarehouses) {
    // //     const existingInventoryItem = await InstallationInventory.findOne({ warehouseId: warehouse._id, subItemId: savedSubItem._id });
    // //     if (!existingInventoryItem) {
    // //         newInventoryItem = new InstallationInventory({ warehouseId: warehouse._id, subItemId: savedSubItem._id, quantity: 0, createdBy: empId });
    // //         savedInventoryItem = await newInventoryItem.save();
    // //     }
    // // }

    // for (let warehouse of allWarehouses) {
    //     // Find an existing inventory item in the warehouse and populate the subItemId to check its name
    //     // const existingInventoryItem = await InstallationInventory.findOne({ warehouseId: warehouse._id })
    //     //     .populate('systemItemId'); // Populate subItemId to get the name field

    //     // // Check if an inventory item exists with the same name
    //     // const itemExists = existingInventoryItem && existingInventoryItem.systemItemId.itemName.toLowerCase().trim() === savedSystemSubItem.itemName.toLowerCase().trim();

    //     // if (!itemExists) {
    //     //     const newInventoryItem = new InstallationInventory({
    //     //         warehouseId: warehouse._id,
    //     //         systemItemId: savedSubItem._id,
    //     //         quantity: 0,
    //     //         createdBy: empId
    //     //     });

    //     //     await newInventoryItem.save();

    //     // Check if inventory item already exists for that warehouse, systemId, and systemItemId
    //     const existingInventoryItem = await InstallationInventory.findOne({
    //         warehouseId: warehouse._id,
    //         //systemId: systemId,
    //         systemItemId: systemItemId
    //     });

    //     if (!existingInventoryItem) {
    //         const newInventoryItem = new InstallationInventory({
    //             warehouseId: warehouse._id,
    //             //systemId: systemId,
    //             systemItemId: systemItemId,
    //             quantity: 0,
    //             createdBy: empId
    //         });

    //         await newInventoryItem.save();
    //     }
    // }
    if (savedSystemSubItem) {
      return res.status(200).json({
        success: true,
        message: "System & SystemItem Attached Successfully",
        data: savedSystemSubItem,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showSystems = async (req, res) => {
  try {
    const systems = await System.find()
      .select("-__v -createdAt -updatedAt -createdBy -updatedBy")
      .lean();
    if (systems) {
      res.status(200).json({
        success: true,
        data: systems,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports.showSystemItems = async (req, res) => {
  try {
    // const { systemId } = req.query;
    // if (!systemId) {
    //     return res.status(400).json({
    //         success: false,
    //         message: "SystemId Not Found"
    //     });
    // }

    const systemItemData = await SystemItem.find()
      .select("-__v -createdAt -updatedAt -createdBy -updatedBy")
      .lean();
    if (systemItemData) {
      return res.status(200).json({
        success: true,
        message: "System Item Fetched Successfully",
        data: systemItemData || [],
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showSystemItemMapData = async (req, res) => {
  try {
    const { systemId } = req.query;
    const systemSubItemData = await SystemItemMap.find({ systemId: systemId })
      .populate({
        path: "systemItemId",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select("-_id -__v -createdAt -updatedAt -createdBy -updatedBy")
      .lean();
    if (!systemSubItemData.length) {
      return res.status(404).json({
        success: false,
        message: "No system items found for this system.",
      });
    }
    res.status(200).json({
      success: true,
      data: systemSubItemData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports.showItemComponents = async (req, res) => {
  try {
    const { systemId, systemItemId } = req.query;
    if (!systemId || !systemItemId) {
      return res.status(400).json({
        success: false,
        message: "systemId and systemItemId are required",
      });
    }
    const itemComponentData = await ItemComponentMap.find({
      systemId,
      systemItemId,
    })
      .populate({
        path: "subItemId",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select(
        "-systemId -systemItemId -_id -__v -createdAt -updatedAt -createdBy -updatedBy",
      )
      .lean();
    if (!itemComponentData.length) {
      return res.status(404).json({
        success: false,
        message: "No item components found for this system item.",
      });
    }
    res.status(200).json({
      success: true,
      data: itemComponentData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showInstallationInventoryItems = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const inventorySystemItems = await InstallationInventory.find({
      warehouseId: warehouseId,
    })
      .populate({
        path: "systemItemId",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select(
        "-_id -warehouseId -createdAt -updatedAt -createdBy -updatedBy -__v",
      )
      .lean();
    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: inventorySystemItems || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Helper to extract pump head from itemName
function getPumpHead(itemName) {
  if (!itemName) return null;
  const match = itemName.trim().match(/(\d+\.?\d*)\s*M$/i);
  if (match) return match[0].toUpperCase().replace(/\s+/g, "");
  return null;
}

module.exports.showItemsWithStockStatus = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouse;
    const systemId = req.query.systemId;

    if (!systemId) {
      return res
        .status(400)
        .json({ success: false, message: "systemId is required" });
    }

    // Step 1: Fetch all system items
    const systemItems = await SystemItemMap.find({ systemId })
      .populate({ path: "systemItemId", select: "_id itemName" })
      .select("systemItemId quantity")
      .lean();

    // Extract pumpHead from itemName
    systemItems.forEach((item) => {
      item.systemItemId.pumpHead = getPumpHead(item.systemItemId.itemName);
    });

    const pumps = systemItems.filter((i) => i.systemItemId.pumpHead);
    const commonItems = systemItems.filter((i) => !i.systemItemId.pumpHead);

    // Step 2: Fetch all sub-items
    const subItems = await ItemComponentMap.find({ systemId })
      .populate({ path: "subItemId", select: "_id itemName" })
      .select("systemItemId subItemId quantity")
      .lean();

    // Step 3: Fetch inventory for all items
    const allItemIds = [
      ...systemItems.map((i) => i.systemItemId._id.toString()),
      ...subItems.map((i) => i.subItemId._id.toString()),
    ];

    const inventoryItems = await InstallationInventory.find({
      warehouseId,
      systemItemId: { $in: allItemIds },
    })
      .populate({ path: "systemItemId", select: "_id itemName" })
      .select("systemItemId quantity")
      .lean();

    const inventoryMap = new Map();
    inventoryItems.forEach((item) => {
      const id = item.systemItemId._id.toString();
      inventoryMap.set(id, {
        systemItemId: item.systemItemId,
        quantity: item.quantity,
      });
    });

    // -------------------------------
    // Step 4: Calculate overall stock (global)
    // -------------------------------
    let overallRequiredQtyMap = new Map();
    let overallItemIds = new Set();

    systemItems.forEach(({ systemItemId, quantity }) => {
      const id = systemItemId._id.toString();
      overallRequiredQtyMap.set(id, quantity);
      overallItemIds.add(id);
    });

    subItems.forEach(({ subItemId, quantity }) => {
      const id = subItemId._id.toString();
      overallRequiredQtyMap.set(
        id,
        (overallRequiredQtyMap.get(id) || 0) + quantity,
      );
      overallItemIds.add(id);
    });

    const overallItemIdsArray = Array.from(overallItemIds);
    let overallMinDispatchableSystems = Infinity;
    const overallStockStatus = [];

    for (const id of overallItemIdsArray) {
      const requiredPerSystem = overallRequiredQtyMap.get(id);
      const availableQty = inventoryMap.get(id)?.quantity || 0;
      const possibleSystems =
        requiredPerSystem > 0
          ? Math.floor(availableQty / requiredPerSystem)
          : Infinity;

      if (possibleSystems < overallMinDispatchableSystems)
        overallMinDispatchableSystems = possibleSystems;

      overallStockStatus.push({
        systemItemId: inventoryMap.get(id)?.systemItemId || {
          _id: id,
          itemName: "Unknown Item",
        },
        quantity: availableQty,
        requiredQuantity: requiredPerSystem,
        stockLow: availableQty < requiredPerSystem,
        materialShort: Math.max(0, requiredPerSystem - availableQty),
      });
    }

    if (overallMinDispatchableSystems === Infinity)
      overallMinDispatchableSystems = 0;

    // Sort overall stock by quantity ascending
    overallStockStatus.sort((a, b) => a.quantity - b.quantity);

    // -------------------------------
    // Step 5: Group by pump head
    // -------------------------------
    const uniquePumpHeads = [
      ...new Set(pumps.map((p) => p.systemItemId.pumpHead)),
    ];
    const pumpDispatchData = [];
    let totalDispatchableSystems = 0;

    for (const pumpHead of uniquePumpHeads) {
      const pumpsForHead = pumps.filter(
        (p) => p.systemItemId.pumpHead === pumpHead,
      );

      let requiredQtyMap = new Map();
      let itemIdSet = new Set();

      pumpsForHead.forEach(({ systemItemId, quantity }) => {
        const id = systemItemId._id.toString();
        requiredQtyMap.set(id, quantity);
        itemIdSet.add(id);
      });

      const relevantSubItems = subItems.filter((sub) =>
        pumpsForHead.some(
          (p) => p.systemItemId._id.toString() === sub.systemItemId.toString(),
        ),
      );

      relevantSubItems.forEach(({ subItemId, quantity }) => {
        const id = subItemId._id.toString();
        requiredQtyMap.set(id, (requiredQtyMap.get(id) || 0) + quantity);
        itemIdSet.add(id);
      });

      commonItems.forEach(({ systemItemId, quantity }) => {
        const id = systemItemId._id.toString();
        requiredQtyMap.set(id, (requiredQtyMap.get(id) || 0) + quantity);
        itemIdSet.add(id);
      });

      const itemIds = Array.from(itemIdSet);
      let minDispatchableSystems = Infinity;
      const stockStatus = [];

      for (const id of itemIds) {
        const requiredPerSystem = requiredQtyMap.get(id);
        const availableQty = inventoryMap.get(id)?.quantity || 0;
        const possibleSystems =
          requiredPerSystem > 0
            ? Math.floor(availableQty / requiredPerSystem)
            : Infinity;

        if (possibleSystems < minDispatchableSystems)
          minDispatchableSystems = possibleSystems;

        stockStatus.push({
          systemItemId: inventoryMap.get(id)?.systemItemId || {
            _id: id,
            itemName: "Unknown Item",
          },
          quantity: availableQty,
          requiredQuantity: requiredPerSystem,
          stockLow: availableQty < requiredPerSystem,
          materialShort: Math.max(0, requiredPerSystem - availableQty),
        });
      }

      if (minDispatchableSystems === Infinity) minDispatchableSystems = 0;
      totalDispatchableSystems += minDispatchableSystems;

      // Sort pump head stock by quantity ascending
      stockStatus.sort((a, b) => a.quantity - b.quantity);

      pumpDispatchData.push({
        pumpHead,
        dispatchableSystems: minDispatchableSystems,
        stockStatus,
      });
      pumpDispatchData.sort((a, b) => {
        const numA = parseFloat(a.pumpHead.replace("M", ""));
        const numB = parseFloat(b.pumpHead.replace("M", ""));
        return numA - numB;
      });
    }

    return res.status(200).json({
      success: true,
      message: "Inventory fetched with overall and pump-head grouped stock",
      data: overallStockStatus,
      pumpHeadData: pumpDispatchData,
      totalDispatchableSystems,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.updateItemQuantity = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const { systemItemId, updatedQuantity } = req.body;

    const filter = {
      warehouseId: warehouseId,
      systemItemId: systemItemId,
    };
    const itemData = await InstallationInventory.findOne(filter);
    itemData.quantity = parseInt(itemData.quantity) + parseInt(updatedQuantity);
    itemData.updatedAt = Date.now();
    itemData.updatedBy = req.user._id;
    let refType;
    if (req.user.role === "admin") {
      refType = "Admin";
    } else if (req.user.role === "warehouseAdmin") {
      refType = "WarehousePerson";
    }

    const insertData = {
      referenceType: refType,
      warehouseId,
      systemItemId,
      quantity: parseInt(updatedQuantity),
      createdAt: new Date(),
      createdBy: req.user._id,
    };

    const addStock = new StockUpdateActivity(insertData);
    const savedStock = await addStock.save();
    const updatedItemData = await itemData.save();

    if (savedStock && updatedItemData) {
      return res.status(200).json({
        success: true,
        message: "Stock Activity & Data Updated Successfully",
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

function validateKeys(arr, requiredKeys) {
  for (let i = 0; i < arr.length; i++) {
    const obj = arr[i];

    for (const key of requiredKeys) {
      if (!obj.hasOwnProperty(key)) {
        return {
          success: false,
          message: `Missing ${key} in the data`,
        };
      }
    }
  }

  return {
    success: true,
    message: "Data validated successfully",
  };
}

module.exports.getControllerData = async (req, res) => {
  try {
    const systemId = req.query?.systemId?.trim();
    if (!systemId) {
      return res.status(400).json({
        success: false,
        message: "SystemId is required",
      });
    }
    const systemData = await System.findById(systemId).select("systemName");
    console.log(systemData);
    const systemName = systemData?.systemName;

    // 🧠 Example: "7.5HP DC System" → ["7.5HP", "DC"]
    const parts = systemName.split(" ").filter(Boolean);
    if (parts[parts.length - 1].toLowerCase() === "system") {
      parts.pop();
    }

    const [hp, controllerType] = parts;
    if (!hp || !controllerType) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid systemName format. Expected format like '7.5HP DC System'",
      });
    }

    console.log("Searching for:", hp, controllerType);

    // 🔒 Escape special characters
    const escapedHp = hp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // ✅ Strict match: must have space, hyphen, or start before HP
    // and cannot have digits or dots before it
    const hpRegex = new RegExp(`(^|\\s|-)${escapedHp}(?![0-9.])`, "i");
    const controllerTypeRegex = new RegExp(controllerType, "i");
    const controllerRegex = /Controller/i;

    const matchingItems = await SystemItem.find({
      $and: [
        { itemName: { $regex: controllerRegex } },
        { itemName: { $regex: hpRegex } },
        { itemName: { $regex: controllerTypeRegex } },
      ],
    }).sort({ createdAt: 1 });

    console.log("Found items:", matchingItems.length);

    if (!matchingItems.length) {
      return res.status(404).json({
        success: false,
        message: `No matching controllers found for ${systemName}`,
      });
    }

    return res.status(200).json({
      success: true,
      systemName,
      total: matchingItems.length,
      items: matchingItems.map((item) => ({
        id: item._id,
        name: item.itemName,
      })),
    });
  } catch (error) {
    console.error("Error fetching controller data:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getClampData = async (req, res) => {
  try {
    const systemId = req.query?.systemId?.trim();
    if (!systemId) {
      return res.status(400).json({
        success: false,
        message: "SystemId is required",
      });
    }

    const systemData = await System.findById(systemId).select("systemName");
    if (!systemData) {
      return res.status(400).json({
        success: false,
        message: "System Not Found",
      });
    }

    const systemItemMap = await SystemItemMap.find({ systemId }).populate(
      "systemItemId",
      "_id itemName",
    );

    const clampData = systemItemMap
      .filter((item) =>
        item.systemItemId?.itemName
          ?.toLowerCase()
          .includes("submersible clamp"),
      )
      .map((item) => ({
        _id: item.systemItemId._id,
        itemName: item.systemItemId.itemName,
      }));

    return res.status(200).json({
      success: true,
      message: "Submersible clamp data fetched successfully",
      data: clampData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.addNewInstallationData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { dispatchedSystem, driverName, driverContact, vehicleNumber } =
      req.body;
    console.log(req.body);
    const dispatchedSystems =
      typeof dispatchedSystem === "string"
        ? JSON.parse(dispatchedSystem)
        : dispatchedSystem;

    if (!Array.isArray(dispatchedSystems) || dispatchedSystems.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No dispatched systems provided" });

    const uploadedFiles = req.files || [];
    if (uploadedFiles.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No bill photos uploaded" });

    const billPhotosMap = {};
    uploadedFiles.forEach((file) => {
      const match = file.fieldname.match(/dispatchBillPhoto(\d+)/);
      if (match) billPhotosMap[parseInt(match[1], 10) - 1] = file;
    });

    if (Object.keys(billPhotosMap).length !== dispatchedSystems.length)
      return res.status(400).json({
        success: false,
        message: `Each dispatched system must have exactly one bill photo (${dispatchedSystems.length} required, got ${Object.keys(billPhotosMap).length})`,
      });

    if (!driverName || !driverContact || !vehicleNumber)
      return res.status(400).json({
        success: false,
        message: "Driver name, contact, and vehicle number are required",
      });

    const requiredKeys = [
      "installerId",
      "farmerSaralId",
      "systemId",
      "pumpId",
      "controllerId",
      "submersibleClampId",
    ];
    const keyValidation = validateKeys(dispatchedSystems, requiredKeys);
    if (!keyValidation.success) return res.status(400).json(keyValidation);

    const warehousePersonId = req.user._id;
    const warehouseId = req.user.warehouse;
    const warehouseData =
      await Warehouse.findById(warehouseId).session(session);
    if (!warehouseData) throw new Error("Warehouse not found");

    const stateMap = {
      Bhiwani: "Haryana",
      "Maharashtra Warehouse - Ambad": "Maharashtra",
      "Maharashtra Warehouse - Badnapur": "Maharashtra",
      "Korba Chhattisgarh": "Chhattisgarh",
    };
    const state = stateMap[warehouseData.warehouseName] || "";

    const dispatchDetails = new DispatchDetails({
      driverName,
      driverContact,
      vehicleNumber,
      dispatchedBy: warehousePersonId,
      warehouseId,
      dispatchedSystems: [],
    });
    await dispatchDetails.save({ session });

    const farmerActivities = [];
    const assignedEmps = [];

    for (let i = 0; i < dispatchedSystems.length; i++) {
      const system = dispatchedSystems[i];
      const clampId =
        system.submersibleClampId &&
        system.submersibleClampId !== "" &&
        system.submersibleClampId !== "null"
          ? system.submersibleClampId
          : null;
      const billPhotoFile = billPhotosMap[i];
      const billPhotoPath = `/uploads/dispatchedSystems/dispatchBillPhoto/${billPhotoFile.filename}`;

      const existingActivity = await FarmerItemsActivity.findOne({
        farmerSaralId: system.farmerSaralId,
      }).session(session);

      if (existingActivity)
        throw new Error(
          `Farmer ${system.farmerSaralId} system already dispatched`,
        );

      let empData = await ServicePerson.findById(system.installerId).session(
        session,
      );
      let refType = "ServicePerson";

      if (!empData) {
        empData = await SurveyPerson.findById(system.installerId).session(
          session,
        );
        if (!empData) throw new Error("Installer not found");
        refType = "SurveyPerson";
      }

      const systemItems = await SystemItemMap.find({
        systemId: system.systemId,
      })
        .populate("systemItemId", "itemName")
        .session(session);
      if (!systemItems.length)
        throw new Error(
          `No system items found for systemId: ${system.systemId}`,
        );

      const filteredSystemItems = systemItems.filter((item) => {
        const name = item.systemItemId?.itemName?.toLowerCase() || "";
        if (name.includes("controller")) return false;
        if (
          name.includes("pump") &&
          item.systemItemId._id.toString() !== system.pumpId.toString()
        )
          return false;
        return true;
      });

      const selectedPump = systemItems.find(
        (item) => item.systemItemId._id.toString() === system.pumpId.toString(),
      );
      if (!selectedPump)
        throw new Error(`Pump with ID ${system.pumpId} not found`);

      const pumpComponents = await ItemComponentMap.find({
        systemId: system.systemId,
        systemItemId: system.pumpId,
      })
        .populate("subItemId", "itemName")
        .session(session);
      const filteredPumpComponents = pumpComponents.filter((comp) => {
        const name = comp.subItemId?.itemName?.toLowerCase() || "";
        if (name.includes("controller") || name.includes("rmu")) return false;
        return true;
      });

      const itemsList = [
        ...filteredSystemItems.map((item) => ({
          systemItemId: item.systemItemId._id,
          quantity: item.quantity,
        })),
        ...filteredPumpComponents.map((comp) => ({
          systemItemId: comp.subItemId._id,
          quantity: comp.quantity,
        })),
      ];

      // ✅ Controller add only once
      if (system.controllerId) {
        const controllerItem = await SystemItem.findById(
          system.controllerId,
        ).session(session);
        if (!controllerItem) throw new Error("Controller not found");
        itemsList.push({ systemItemId: controllerItem._id, quantity: 1 });
      }

      // ✅ Deduplicate
      const uniqueItemsMap = new Map();
      for (const item of itemsList) {
        const id = item.systemItemId.toString();
        uniqueItemsMap.set(
          id,
          uniqueItemsMap.has(id)
            ? {
                ...item,
                quantity: uniqueItemsMap.get(id).quantity + item.quantity,
              }
            : { ...item },
        );
      }

      // ✅ Ensure pump exists only once
      if (!uniqueItemsMap.has(system.pumpId.toString())) {
        uniqueItemsMap.set(system.pumpId.toString(), {
          systemItemId: system.pumpId,
          quantity: selectedPump.quantity,
        });
      }

      let finalItemsList = Array.from(uniqueItemsMap.values());
      //console.log("Before Final Item List: ", finalItemsList);
      console.log("Before Length: ", finalItemsList.length);

      // let clampItemId = null;
      // for (const it of systemItems) {
      //   const name = it.systemItemId?.itemName?.toLowerCase() || "";
      //   if (name.includes("submersible clamp")) {
      //     clampItemId = it.systemItemId._id.toString();
      //     break;
      //   }
      // }

      // // 2️⃣ Remove clamp if no clampId provided in request
      // if (!system.submersibleClampId && clampItemId) {
      //   finalItemsList = finalItemsList.filter(
      //     (item) => item.systemItemId.toString() !== clampItemId
      //   );
      // }

      let clampItemId = null;
      for (const it of systemItems) {
        const name = it.systemItemId?.itemName?.toLowerCase() || "";
        if (name.includes("submersible clamp")) {
          clampItemId = it.systemItemId._id.toString();
          break;
        }
      }

      // ✅ Remove clamp if clampId NOT provided
      if (!clampId && clampItemId) {
        finalItemsList = finalItemsList.filter(
          (item) => item.systemItemId.toString() !== clampItemId,
        );
      }

      //console.log("After Final Item List: ", finalItemsList);
      console.log("After Length: ", finalItemsList.length);

      for (const item of finalItemsList) {
        const stockDoc = await InstallationInventory.findOne({
          warehouseId,
          systemItemId: item.systemItemId,
        })
          .populate("systemItemId")
          .session(session);

        if (!stockDoc)
          throw new Error(`Item not found in inventory: ${item.systemItemId}`);
        if (stockDoc.quantity < item.quantity)
          throw new Error(
            `Insufficient stock for item ${stockDoc.systemItemId.itemName}`,
          );

        stockDoc.quantity =
          Math.round((stockDoc.quantity - item.quantity) * 100) / 100;
        stockDoc.updatedAt = new Date();
        stockDoc.updatedBy = warehousePersonId;
        await stockDoc.save({ session });
      }

      const farmerActivity = new FarmerItemsActivity({
        referenceType: refType,
        warehouseId,
        farmerSaralId: system.farmerSaralId,
        empId: system.installerId,
        systemId: system.systemId,
        itemsList: finalItemsList,
        panelNumbers: [],
        pumpNumber: "",
        controllerNumber: "",
        rmuNumber: "",
        motorNumber: "",
        state,
        createdBy: warehousePersonId,
      });
      await farmerActivity.save({ session });

      const assignedEmp = new InstallationAssignEmp({
        referenceType: refType,
        warehouseId,
        empId: system.installerId,
        farmerSaralId: system.farmerSaralId,
        systemId: system.systemId,
        itemsList: finalItemsList,
        extraItemsList: [],
        createdBy: warehousePersonId,
      });
      await assignedEmp.save({ session });

      const dispatchBillPhoto = new DispatchBillPhoto({
        dispatchId: dispatchDetails._id,
        farmerActivityId: farmerActivity._id,
        billPhoto: billPhotoPath,
      });
      await dispatchBillPhoto.save({ session });

      farmerActivities.push(farmerActivity);
      assignedEmps.push(assignedEmp);
      dispatchDetails.dispatchedSystems.push(farmerActivity._id);

      const updatedOrder = await SystemOrder.findOneAndUpdate(
        {
          systemId: system.systemId,
          pumpId: system.pumpId,
        },
        {
          $inc: { dispatchedOrder: 1 },
        },
        {
          new: true,
          session,
        },
      );

      if (!updatedOrder) {
        throw new Error(
          `SystemOrder not found for systemId ${system.systemId} and pumpId ${system.pumpId}`,
        );
      }
    }
    await dispatchDetails.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `${farmerActivities.length} systems dispatched successfully`,
      data: { dispatchDetails },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    if (req.files) {
      req.files.forEach((file) => {
        fs.unlink(file.path, () => {});
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.addNewInstallationData2 = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { dispatchedSystem, driverName, driverContact, vehicleNumber, farmerSaralId, simNumber } =
      req.body || {};
    const dispatchedSystems =
      typeof dispatchedSystem === "string"
        ? JSON.parse(dispatchedSystem)
        : dispatchedSystem;

    if (!Array.isArray(dispatchedSystems) || dispatchedSystems.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No dispatched systems provided" });

    const uploadedFiles = req.files || [];
    if (uploadedFiles.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "No bill photos uploaded" });

    const billPhotosMap = {};
    uploadedFiles.forEach((file) => {
      const match = file.fieldname.match(/dispatchBillPhoto(\d+)/);
      if (match) billPhotosMap[parseInt(match[1], 10) - 1] = file;
    });

    if (Object.keys(billPhotosMap).length !== dispatchedSystems.length)
      return res.status(400).json({
        success: false,
        message: `Each dispatched system must have exactly one bill photo (${dispatchedSystems.length} required, got ${Object.keys(billPhotosMap).length})`,
      });

    if (!driverName || !driverContact || !vehicleNumber)
      return res.status(400).json({
        success: false,
        message: "Driver name, contact, and vehicle number are required",
      });

    const requiredKeys = [
      //"installerId",
      "farmerSaralId",
      "systemId",
      "pumpId",
      "controllerId",
      "submersibleClampId",
    ];
    const keyValidation = validateKeys(dispatchedSystems, requiredKeys);
    if (!keyValidation.success) return res.status(400).json(keyValidation);

    const warehousePersonId = req.user._id;
    const warehouseId = req.user.warehouse;
    const warehouseData =
      await Warehouse.findById(warehouseId).session(session);
    if (!warehouseData) throw new Error("Warehouse not found");

    const stateMap = {
      Bhiwani: "Haryana",
      "Maharashtra Warehouse - Ambad": "Maharashtra",
      "Maharashtra Warehouse - Badnapur": "Maharashtra",
      "Korba Chhattisgarh": "Chhattisgarh",
    };
    const state = stateMap[warehouseData.warehouseName] || "";

    const dispatchDetails = new DispatchDetails({
      driverName,
      driverContact,
      vehicleNumber,
      dispatchedBy: warehousePersonId,
      warehouseId,
      dispatchedSystems: [],
    });
    await dispatchDetails.save({ session });

    const farmerActivities = [];
    const assignedEmps = [];

    for (let i = 0; i < dispatchedSystems.length; i++) {
      const system = dispatchedSystems[i];
      const clampId =
        system.submersibleClampId &&
        system.submersibleClampId !== "" &&
        system.submersibleClampId !== "null"
          ? system.submersibleClampId
          : null;
      const billPhotoFile = billPhotosMap[i];
      const billPhotoPath = `/uploads/dispatchedSystems/dispatchBillPhoto/${billPhotoFile.filename}`;

      const existingActivity = await FarmerItemsActivity.findOne({
        farmerSaralId: system.farmerSaralId,
      }).session(session);

      if (existingActivity)
        throw new Error(
          `Farmer ${system.farmerSaralId} system already dispatched`,
        );

      // let empData = await ServicePerson.findById(system.installerId).session(
      //   session
      // );
      // let refType = "ServicePerson";

      // if (!empData) {
      //   empData = await SurveyPerson.findById(system.installerId).session(
      //     session
      //   );
      //   if (!empData) throw new Error("Installer not found");
      //   refType = "SurveyPerson";
      // }

      const systemItems = await SystemItemMap.find({
        systemId: system.systemId,
      })
        .populate("systemItemId", "itemName")
        .session(session);
      if (!systemItems.length)
        throw new Error(
          `No system items found for systemId: ${system.systemId}`,
        );

      const filteredSystemItems = systemItems.filter((item) => {
        const name = item.systemItemId?.itemName?.toLowerCase() || "";
        if (name.includes("controller")) return false;
        if (
          name.includes("pump") &&
          item.systemItemId._id.toString() !== system.pumpId.toString()
        )
          return false;
        return true;
      });

      const selectedPump = systemItems.find(
        (item) => item.systemItemId._id.toString() === system.pumpId.toString(),
      );
      if (!selectedPump)
        throw new Error(`Pump with ID ${system.pumpId} not found`);

      const pumpComponents = await ItemComponentMap.find({
        systemId: system.systemId,
        systemItemId: system.pumpId,
      })
        .populate("subItemId", "itemName")
        .session(session);
      const filteredPumpComponents = pumpComponents.filter((comp) => {
        const name = comp.subItemId?.itemName?.toLowerCase() || "";
        if (name.includes("controller") || name.includes("rmu")) return false;
        return true;
      });

      const itemsList = [
        ...filteredSystemItems.map((item) => ({
          systemItemId: item.systemItemId._id,
          quantity: item.quantity,
        })),
        ...filteredPumpComponents.map((comp) => ({
          systemItemId: comp.subItemId._id,
          quantity: comp.quantity,
        })),
      ];

      // ✅ Controller add only once
      if (system.controllerId) {
        const controllerItem = await SystemItem.findById(
          system.controllerId,
        ).session(session);
        if (!controllerItem) throw new Error("Controller not found");
        itemsList.push({ systemItemId: controllerItem._id, quantity: 1 });
      }

      // ✅ Deduplicate
      const uniqueItemsMap = new Map();
      for (const item of itemsList) {
        const id = item.systemItemId.toString();
        uniqueItemsMap.set(
          id,
          uniqueItemsMap.has(id)
            ? {
                ...item,
                quantity: uniqueItemsMap.get(id).quantity + item.quantity,
              }
            : { ...item },
        );
      }

      // ✅ Ensure pump exists only once
      if (!uniqueItemsMap.has(system.pumpId.toString())) {
        uniqueItemsMap.set(system.pumpId.toString(), {
          systemItemId: system.pumpId,
          quantity: selectedPump.quantity,
        });
      }

      let finalItemsList = Array.from(uniqueItemsMap.values());
      //console.log("Before Final Item List: ", finalItemsList);
      console.log("Before Length: ", finalItemsList.length);

      // let clampItemId = null;
      // for (const it of systemItems) {
      //   const name = it.systemItemId?.itemName?.toLowerCase() || "";
      //   if (name.includes("submersible clamp")) {
      //     clampItemId = it.systemItemId._id.toString();
      //     break;
      //   }
      // }

      // // 2️⃣ Remove clamp if no clampId provided in request
      // if (!system.submersibleClampId && clampItemId) {
      //   finalItemsList = finalItemsList.filter(
      //     (item) => item.systemItemId.toString() !== clampItemId
      //   );
      // }

      let clampItemId = null;
      for (const it of systemItems) {
        const name = it.systemItemId?.itemName?.toLowerCase() || "";
        if (name.includes("submersible clamp")) {
          clampItemId = it.systemItemId._id.toString();
          break;
        }
      }

      // ✅ Remove clamp if clampId NOT provided
      if (!clampId && clampItemId) {
        finalItemsList = finalItemsList.filter(
          (item) => item.systemItemId.toString() !== clampItemId,
        );
      }

      //console.log("After Final Item List: ", finalItemsList);
      console.log("After Length: ", finalItemsList.length);

      for (const item of finalItemsList) {
        const stockDoc = await InstallationInventory.findOne({
          warehouseId,
          systemItemId: item.systemItemId,
        })
          .populate("systemItemId")
          .session(session);

        if (!stockDoc)
          throw new Error(`Item not found in inventory: ${item.systemItemId}`);
        if (stockDoc.quantity < item.quantity)
          throw new Error(
            `Insufficient stock for item ${stockDoc.systemItemId.itemName}`,
          );

        stockDoc.quantity =
          Math.round((stockDoc.quantity - item.quantity) * 100) / 100;
        stockDoc.updatedAt = new Date();
        stockDoc.updatedBy = warehousePersonId;
        await stockDoc.save({ session });
      }

      const farmerActivity = new FarmerItemsActivity({
        //referenceType: refType,
        warehouseId,
        farmerSaralId: system.farmerSaralId,
        //empId: system.installerId,
        systemId: system.systemId,
        itemsList: finalItemsList,
        panelNumbers: [],
        pumpNumber: "",
        controllerNumber: "",
        rmuNumber: "",
        motorNumber: "",
        state,
        createdBy: warehousePersonId,
      });
      await farmerActivity.save({ session });

      const assignedEmp = new InstallationAssignEmp({
        //referenceType: refType,
        warehouseId,
        //empId: system.installerId,
        farmerSaralId: system.farmerSaralId,
        systemId: system.systemId,
        itemsList: finalItemsList,
        extraItemsList: [],
        createdBy: warehousePersonId,
      });
      await assignedEmp.save({ session });

      const dispatchBillPhoto = new DispatchBillPhoto({
        dispatchId: dispatchDetails._id,
        farmerActivityId: farmerActivity._id,
        billPhoto: billPhotoPath,
      });
      await dispatchBillPhoto.save({ session });

      farmerActivities.push(farmerActivity);
      assignedEmps.push(assignedEmp);
      dispatchDetails.dispatchedSystems.push(farmerActivity._id);

      const updatedOrder = await SystemOrder.findOneAndUpdate(
        {
          systemId: system.systemId,
          pumpId: system.pumpId,
        },
        {
          $inc: { dispatchedOrder: 1 },
        },
        {
          new: true,
          session,
        },
      );

      if (!updatedOrder) {
        throw new Error(
          `SystemOrder not found for systemId ${system.systemId} and pumpId ${system.pumpId}`,
        );
      }
    }
    await dispatchDetails.save({ session });
    await session.commitTransaction();
    session.endSession();
        let simWarning = null;
    if (farmerSaralId && simNumber) {
      try {
        await apiRequest(
          `${process.env.SERVICE_URL}sim/check-sim-assign-saralId`,
          "PUT",
          { farmerSaralId, simNumber },
        );
      } catch (e) {
        console.error("SIM assignment failed:", e);
        simWarning = "Dispatched, but SIM assignment failed";
      }
    }

    return res.status(200).json({
      success: true,
      message: `${farmerActivities.length} systems dispatched successfully`,
      ...(simWarning && { warning: simWarning }),
      data: { dispatchDetails },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    if (req.files) {
      req.files.forEach((file) => {
        fs.unlink(file.path, () => {});
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.assignInstaller = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { farmerActivityId, farmerSaralId, installerId, updatedByEmp } =
      req.body;

    if (!farmerActivityId || !farmerSaralId || !installerId || !updatedByEmp) {
      return res.status(400).json({
        success: false,
        message: "Insufficient Data Provided.",
      });
    }

    const farmerActivity =
      await FarmerItemsActivity.findById(farmerActivityId).session(session);

    if (!farmerActivity) {
      throw new Error("Farmer Activity For Installation Not Found.");
    }

    const installationAssignEmp = await InstallationAssignEmp.findOne({
      farmerSaralId,
    }).session(session);

    if (!installationAssignEmp) {
      throw new Error("Installation Assign Emp Not Found.");
    }

    let refType = null;

    let empData = await ServicePerson.findById(installerId).session(session);

    if (empData) {
      refType = "ServicePerson";
    } else {
      empData = await SurveyPerson.findById(installerId).session(session);

      if (!empData) {
        throw new Error("Installer Data Not Found.");
      }

      refType = "SurveyPerson";
    }

    // Update Farmer Activity
    farmerActivity.referenceType = refType;
    farmerActivity.empId = installerId;
    farmerActivity.updatedAt = new Date();
    farmerActivity.updatedByEmp = updatedByEmp;

    await farmerActivity.save({ session });

    // Update Installation Assign Emp
    installationAssignEmp.referenceType = refType;
    installationAssignEmp.empId = installerId;
    installationAssignEmp.updatedAt = new Date();
    installationAssignEmp.updatedByEmp = updatedByEmp;

    await installationAssignEmp.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `Installer assigned to farmer with beneficiary id: ${farmerSaralId}`,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getDispatchHistory = async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const warehouseId = req.user?.warehouse;

    const history = await DispatchDetails.aggregate([
      {
        $match: {
          warehouseId: new mongoose.Types.ObjectId(warehouseId),
        },
      },

      { $sort: { createdAt: -1 } },

      {
        $lookup: {
          from: "inFarmerItemsActivities",
          localField: "dispatchedSystems",
          foreignField: "_id",
          as: "farmerActivities",
        },
      },
      {
        $lookup: {
          from: "inSystems",
          localField: "farmerActivities.systemId",
          foreignField: "_id",
          as: "systemsInfo",
        },
      },
      {
        $lookup: {
          from: "inDispatchBillPhotos",
          localField: "farmerActivities._id",
          foreignField: "farmerActivityId",
          as: "billPhotos",
        },
      },
      {
        $lookup: {
          from: "inSystemItems",
          localField: "farmerActivities.itemsList.systemItemId",
          foreignField: "_id",
          as: "systemItems",
        },
      },

      {
        $addFields: {
          farmers: {
            $map: {
              input: "$farmerActivities",
              as: "fa",
              in: {
                farmerSaralId: "$$fa.farmerSaralId",

                systemName: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$systemsInfo",
                          as: "s",
                          cond: { $eq: ["$$s._id", "$$fa.systemId"] },
                        },
                      },
                      as: "matched",
                      in: "$$matched.systemName",
                    },
                  },
                },

                // ✅ Pump Data
                pumpData: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: {
                            $map: {
                              input: "$$fa.itemsList",
                              as: "it",
                              in: {
                                $mergeObjects: [
                                  "$$it",
                                  {
                                    systemItemId: {
                                      $first: {
                                        $filter: {
                                          input: "$systemItems",
                                          as: "si",
                                          cond: {
                                            $eq: [
                                              "$$si._id",
                                              "$$it.systemItemId",
                                            ],
                                          },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                          as: "item",
                          cond: {
                            $regexMatch: {
                              input: "$$item.systemItemId.itemName",
                              regex: /pump/i,
                            },
                          },
                        },
                      },
                      as: "matched",
                      in: {
                        name: "$$matched.systemItemId.itemName",
                      },
                    },
                  },
                },

                // ✅ Controller Data
                controllerData: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: {
                            $map: {
                              input: "$$fa.itemsList",
                              as: "it",
                              in: {
                                $mergeObjects: [
                                  "$$it",
                                  {
                                    systemItemId: {
                                      $first: {
                                        $filter: {
                                          input: "$systemItems",
                                          as: "si",
                                          cond: {
                                            $eq: [
                                              "$$si._id",
                                              "$$it.systemItemId",
                                            ],
                                          },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                          as: "item",
                          cond: {
                            $regexMatch: {
                              input: "$$item.systemItemId.itemName",
                              regex: /controller/i,
                            },
                          },
                        },
                      },
                      as: "matched",
                      in: {
                        name: "$$matched.systemItemId.itemName",
                      },
                    },
                  },
                },

                billPhoto: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$billPhotos",
                          as: "bp",
                          cond: { $eq: ["$$bp.farmerActivityId", "$$fa._id"] },
                        },
                      },
                      as: "matched",
                      in: { $concat: [baseUrl, "$$matched.billPhoto"] },
                    },
                  },
                },
              },
            },
          },
        },
      },

      {
        $project: {
          _id: 0,
          dispatchDate: "$createdAt",
          driverName: 1,
          driverContact: 1,
          vehicleNumber: 1,
          farmers: 1,
        },
      },
    ]);

    if (!history.length) {
      return res.status(404).json({
        success: false,
        message: "No dispatch history found for this warehouse",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Dispatch history fetched successfully",
      data: history,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.showInstallationDataToWarehouse = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const showData = await FarmerItemsActivity.find({
      warehouseId: warehouseId,
    })
      .populate({
        path: "warehouseId",
        select: {
          _id: 0,
          warehouseName: 1,
        },
      })
      .populate({
        path: "empId",
        select: {
          _id: 0,
          name: 1,
          contact: 1,
        },
      })
      .populate({
        path: "itemsList.systemItemId", // Populate subItem details
        model: "SystemItem",
        select: {
          _id: 0,
          itemName: 1,
        },
      })
      .populate({
        path: "extraItemsList.systemItemId", // Populate subItem details
        model: "SystemItem",
        select: {
          _id: 0,
          itemName: 1,
        },
      })
      .sort({ createdAt: -1 });

    const activitiesWithFarmerDetails = await Promise.all(
      showData.map(async (data) => {
        try {
          const response = await axios.get(
            `http://88.222.214.93:8001/farmer/showFarmerAccordingToSaralId?saralId=${data.farmerSaralId}`,
          );

          return {
            ...data.toObject(),
            farmerDetails: response?.data?.data || null,
          };
        } catch (err) {
          console.error(
            "Failed to fetch farmer details for SaralId:",
            data.farmerSaralId,
            err.message,
          );
          return {
            ...data.toObject(),
            farmerDetails: null,
          };
        }
      }),
    );

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: activitiesWithFarmerDetails || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.itemComingToWarehouse = async (req, res) => {
  try {
    const { from, toWarehouse, itemsList, company, arrivedDate } = req.body;
    const role = req.user.role;
    if (!from || !toWarehouse || !itemsList || !company || !arrivedDate) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!Array.isArray(itemsList) || itemsList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items is an array & should be non-empty",
      });
    }

    let refType;
    if (role === "admin") {
      refType = "Admin";
    } else if (role === "warehouseAdmin") {
      refType = "WarehousePerson";
    }

    for (let item of itemsList) {
      const { systemItemId, quantity } = item;
      const systemItemData = await SystemItem.findOne({ _id: systemItemId });
      if (!systemItemData) {
        return res.status(400).json({
          success: false,
          message: "SubItem Not Found",
        });
      }

      const existingInventoryItems = await InstallationInventory.find({
        warehouseId: req.user.warehouse,
      }).populate({
        path: "systemItemId",
        select: "itemName",
      });

      // Check if any inventory item has a subItemId with a matching subItemName
      const existingItem = existingInventoryItems.find(
        (inv) =>
          inv.systemItemId.itemName.toLowerCase().trim() ===
          systemItemData.itemName.toLowerCase().trim(),
      );

      if (!existingItem) {
        throw new Error(
          `SubItem "${systemItemData.itemName}" not found in warehouse inventory`,
        );
      }

      // Update inventory quantity
      existingItem.quantity =
        parseInt(existingItem.quantity) + parseInt(quantity);
      await existingItem.save();
    }

    const insertData = {
      referenceType: refType,
      from,
      toWarehouse,
      itemsList,
      company,
      arrivedDate,
      createdBy: req.user._id,
    };

    const incomingInstallationItems = new IncomingItemsAccount(insertData);
    const savedData = await incomingInstallationItems.save();
    if (savedData) {
      return res.status(200).json({
        success: true,
        message:
          "Items Added & Stock Updated To Installation Inventory Account",
        data: savedData,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showIncomingItemToWarehouse = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const incomingItems = await IncomingItemsAccount.find({
      toWarehouse: warehouseId,
    })
      .populate({
        path: "toWarehouse",
        select: {
          _id: 0,
          warehouseName: 1,
        },
      })
      .populate({
        path: "itemsList.systemItemId",
        model: "SystemItem",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select("-createdAt -__v")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: incomingItems || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.warehouse2WarehouseTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      fromWarehouse,
      toWarehouse,
      itemsList,
      driverName,
      driverContact,
      serialNumber,
      remarks,
      outgoing,
      pickupDate,
    } = req.body;

    // 🔸 Basic validation
    if (
      !fromWarehouse ||
      !toWarehouse ||
      !itemsList ||
      !driverName ||
      !driverContact ||
      !remarks ||
      outgoing === undefined ||
      !pickupDate
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!Array.isArray(itemsList) || itemsList.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "itemsList must be a non-empty array",
      });
    }

    // 🔸 Reduce stock if outgoing
    if (outgoing === true) {
      for (const item of itemsList) {
        const { systemItemId, quantity } = item;

        if (!mongoose.Types.ObjectId.isValid(systemItemId)) {
          throw new Error(`Invalid systemItemId: ${systemItemId}`);
        }

        const systemItemData =
          await SystemItem.findById(systemItemId).session(session);
        if (!systemItemData) {
          throw new Error(`SystemItem not found for ID: ${systemItemId}`);
        }

        // 🔹 Find existing inventory entry for that system item in the warehouse
        const existingItem = await InstallationInventory.findOne({
          warehouseId: fromWarehouse,
          systemItemId: systemItemId,
        }).session(session);

        if (!existingItem) {
          throw new Error(
            `Item "${systemItemData.itemName}" not found in warehouse inventory`,
          );
        }

        if (existingItem.quantity < quantity || existingItem.quantity === 0) {
          throw new Error(
            `Insufficient stock for item "${systemItemData.itemName}"`,
          );
        }

        // 🔹 Reduce stock
        existingItem.quantity =
          parseInt(existingItem.quantity) - parseInt(quantity);
        existingItem.updatedAt = new Date();
        existingItem.updatedBy = req.user._id;

        await existingItem.save({ session });
      }
    }

    // 🔸 Create warehouse-to-warehouse transfer record
    const insertData = {
      fromWarehouse,
      toWarehouse,
      itemsList,
      driverName,
      driverContact: Number(driverContact),
      serialNumber,
      remarks,
      outgoing,
      pickupDate,
      createdBy: req.user._id,
    };

    const newDoc = new SystemInventoryWToW(insertData);
    const saved = await newDoc.save({ session });

    // ✅ Commit the transaction
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Transaction saved successfully",
      data: saved,
    });
  } catch (error) {
    console.error("❌ ERROR:", error);
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      success: false,
      message: "Transaction Failed",
      error: error.message,
    });
  }
};

module.exports.showIncomingWToWItems = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseId Not Found",
      });
    }

    const result = await SystemInventoryWToW.find({
      toWarehouse: warehouseId,
      status: false,
    })
      .populate({
        path: "fromWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "toWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "itemsList.systemItemId",
        model: "SystemItem",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select("-createdAt -createdBy -__v")
      .sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: result || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showOutgoingWToWItems = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseId Not Found",
      });
    }

    const result = await SystemInventoryWToW.find({
      fromWarehouse: warehouseId,
    })
      .populate({
        path: "fromWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "toWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "itemsList.systemItemId",
        model: "SystemItem",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select("-createdAt -createdBy -__v")
      .sort({ pickupDate: -1 });
    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: result || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.acceptingWToWIncomingItems = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId, status, arrivedDate } = req.body;

    if (!transactionId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "TransactionId is required",
      });
    }

    let incomingSystemItems = await SystemInventoryWToW.findOne({
      _id: transactionId,
    })
      .populate({
        path: "fromWarehouse",
        select: { _id: 1, warehouseName: 1 },
      })
      .populate({
        path: "toWarehouse",
        select: { _id: 1, warehouseName: 1 },
      })
      .populate({
        path: "itemsList.systemItemId",
        model: "SystemItem",
        select: { _id: 1, itemName: 1 },
      })
      .session(session);

    if (!incomingSystemItems) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Incoming System Items data not found",
      });
    }

    if (incomingSystemItems.status === true) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Incoming items already approved",
      });
    }

    // ✅ Update stock if approved
    if (status === true) {
      for (const item of incomingSystemItems.itemsList) {
        const { systemItemId, quantity } = item;

        if (!mongoose.Types.ObjectId.isValid(systemItemId)) {
          throw new Error(`Invalid systemItemId: ${systemItemId}`);
        }

        const systemItemData =
          await SystemItem.findById(systemItemId).session(session);
        if (!systemItemData) {
          throw new Error(`SystemItem not found for ID: ${systemItemId}`);
        }

        // 🔹 Check if item exists in the receiving warehouse inventory
        let existingItem = await InstallationInventory.findOne({
          warehouseId: incomingSystemItems.toWarehouse._id,
          systemItemId: systemItemId,
        }).session(session);

        if (existingItem) {
          // 🔸 Update existing stock
          existingItem.quantity += parseInt(quantity);
          existingItem.updatedAt = new Date();
          existingItem.updatedBy = req.user._id;
          await existingItem.save({ session });
        } else {
          // 🔸 Create new inventory entry if item doesn’t exist
          const newInventoryItem = new InstallationInventory({
            warehouseId: incomingSystemItems.toWarehouse._id,
            systemItemId: systemItemId,
            quantity: parseInt(quantity),
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: req.user._id,
            updatedBy: req.user._id,
          });
          await newInventoryItem.save({ session });
        }
      }
    }

    // ✅ Update transaction record
    incomingSystemItems.status = status;
    incomingSystemItems.arrivedDate = arrivedDate;
    incomingSystemItems.approvedBy = req.user._id;
    incomingSystemItems.updatedAt = new Date();
    incomingSystemItems.updatedBy = req.user._id;
    await incomingSystemItems.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Incoming System Items Approved Successfully",
    });
  } catch (error) {
    console.error("❌ ERROR:", error);
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.incomingWToWSystemItemsHistory = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const approvedData = await SystemInventoryWToW.find({
      toWarehouse: warehouseId,
      status: true,
    })
      .populate({
        path: "fromWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "toWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "itemsList.systemItemId",
        model: "SystemItem",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .sort({ arrivedDate: -1 });

    return res.status(200).json({
      success: true,
      message: "Approved Data Fetched Successfully",
      data: approvedData || [],
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.outgoingWToWSystemItemsHistory = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;
    const approvedOutgoingItems = await SystemInventoryWToW.find({
      fromWarehouse: warehouseId,
      status: true,
    })
      .populate({
        path: "fromWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "toWarehouse",
        select: {
          _id: 1,
          warehouseName: 1,
        },
      })
      .populate({
        path: "itemsList.systemItemId",
        model: "SystemItem",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .sort({ pickupDate: -1 });
    return res.status(200).json({
      success: true,
      message: "Approved Outgoing Items History",
      data: approvedOutgoingItems || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.allServiceSurveyPersons = async (req, res) => {
  try {
    const { state } = req.query;
    console.log("State:", state);

    const filter = { isActive: true };
    if (state) {
      filter.state = state;
    }

    // Fetch servicepersons with role = serviceperson OR fieldsales
    const servicePersons = await ServicePerson.find({
      ...filter,
      role: { $in: ["serviceperson", "fieldsales", "filing"] },
    })
      .select(
        "-password -createdAt -createdBy -updatedAt -updatedBy -refreshToken -isActive -__v",
      )
      .sort({ state: 1, district: 1 });

    // Fetch survey persons
    const surveyPersons = await SurveyPerson.find(filter)
      .select(
        "-password -createdAt -createdBy -updatedAt -updatedBy -refreshToken -isActive -__v",
      )
      .sort({ state: 1, district: 1 });

    // Merge both lists
    const allPersons = [
      ...surveyPersons.map((person) => ({
        ...person._doc,
        role: "surveyperson",
      })),
      ...servicePersons.map((person) => ({
        ...person._doc,
        role: person.role,
      })), // keep actual role
    ];

    const cleanedData = allPersons.map((item) => ({
      _id: item._id,
      name: item.name,
      role: item.role,
      email: item.email,
      contact: item.contact,
      state: item.state,
      district: item.district,
      block: item.block,
      latitude: item.latitude,
      longitude: item.longitude,
    }));

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: cleanedData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.fieldWorkerList = async (req, res) => {
  try {
    const { state } = req.query;
    console.log("State:", state);
    const filter = { isActive: true };
    if (state) {
      filter.state = state;
    }
    const [servicePersons, surveyPersons] = await Promise.all([
      ServicePerson.find(filter)
        .select(
          "-password -createdAt -createdBy -updatedAt -updatedBy -refreshToken -isActive -__v",
        )
        .sort({ state: 1, district: 1 }),
      SurveyPerson.find(filter)
        .select(
          "-password -createdAt -createdBy -updatedAt -updatedBy -refreshToken -isActive -__v",
        )
        .sort({ state: 1, district: 1 }),
    ]);

    // const filterServicePerson = servicePersons.filter((person) => {
    //     return person.role === 'serviceperson';
    //         //|| person.role === 'fieldsales'
    //     });

    const allPersons = [
      ...surveyPersons.map((person) => ({ ...person })),
      ...servicePersons.map((person) => ({ ...person })),
    ];

    const cleanedData = allPersons.map((item) => ({
      _id: item._doc._id,
      name: item._doc.name,
      role: item.role,
      email: item._doc.email,
      contact: item._doc.contact,
      state: item._doc.state,
      district: item._doc.district,
      block: item._doc.block,
      latitude: item._doc.latitude,
      longitude: item._doc.longitude,
    }));

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: cleanedData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.servicePersonForMaharashtra = async (req, res) => {
  try {
    const { state } = req.query;
    console.log("State:", state);
    const filter = { isActive: true };
    if (state) {
      filter.state = state;
    }
    const [servicePersons, surveyPersons] = await Promise.all([
      ServicePerson.find(filter)
        .select(
          "-password -createdAt -createdBy -updatedAt -updatedBy -refreshToken -isActive -__v",
        )
        .sort({ state: 1, district: 1 }),
      SurveyPerson.find(filter)
        .select(
          "-password -createdAt -createdBy -updatedAt -updatedBy -refreshToken -isActive -__v",
        )
        .sort({ state: 1, district: 1 }),
    ]);

    //const filterServicePerson = servicePersons.filter((person) => { return person.role === 'serviceperson'});

    const allPersons = [
      ...surveyPersons.map((person) => ({ ...person })),
      ...servicePersons.map((person) => ({ ...person })),
    ];

    const cleanedData = allPersons.map((item) => ({
      _id: item._doc._id,
      name: item._doc.name,
      role: item.role,
      email: item._doc.email,
      contact: item._doc.contact,
      state: item._doc.state,
      district: item._doc.district,
      block: item._doc.block,
      latitude: item._doc.latitude,
      longitude: item._doc.longitude,
    }));

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: cleanedData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.filterServicePersonById = async (req, res) => {
  try {
    const { id } = req.query;
    let employeeName = await ServicePerson.findById({ _id: id }).select(
      "-email -password -role -createdAt -refreshToken -__v -createdAt -updatedAt -createdBy -updatedBy",
    );
    if (!employeeName) {
      employeeName = await SurveyPerson.findById({ _id: id }).select(
        "-email -password -role -createdAt -refreshToken -__v -createdAt -updatedAt -createdBy -updatedBy",
      );
    }
    return res.status(200).json({
      success: true,
      message: "Service Person Found",
      data: employeeName || "",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.filterStateWiseServicePerson = async (req, res) => {
  try {
    const { state } = req.query;

    if (state) {
      // Query to count service persons in the specified state
      const count = await ServicePerson.countDocuments({ state });
      return res.status(200).json({
        success: true,
        message: `Number of service persons in state: ${state}`,
        state,
        count,
      });
    } else {
      // Aggregate query to group service persons by state and count them
      const servicePersonsByState = await ServicePerson.aggregate([
        {
          $match: {
            state: { $ne: null }, // Exclude documents with null state
          },
        },
        {
          $group: {
            _id: "$state", // Group by state
            count: { $sum: 1 }, // Count the number of documents
          },
        },
        {
          $project: {
            state: "$_id", // Rename `_id` to `state`
            count: 1, // Include the count field
            _id: 0, // Exclude the original `_id` field
          },
        },
      ]);

      return res.status(200).json({
        success: true,
        message: "All service persons grouped by state",
        data: servicePersonsByState,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.servicePersonBlockData = async (req, res) => {
  try {
    const blockData = await ServicePerson.find().select("_id name block");
    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: blockData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showWarehousePersons = async (req, res) => {
  try {
    const id = req.query.id;
    const filter = {};
    if (id) filter._id = id;
    const allWarehousePersons =
      await WarehousePerson.find(filter).select("_id name");
    return res.status(200).json({
      success: true,
      message: "Warehouse Persons Data Fetched Successfully",
      data: allWarehousePersons || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showIncomingItemsFromFarmer = async (req, res) => {
  try {
    const contact = req.query.contact;
    const contact2 = req.query.contact2;

    // Validate that at least one contact is provided and is a number
    if ((!contact || isNaN(contact)) && (!contact2 || isNaN(contact2))) {
      return res.status(400).json({
        success: false,
        message: "At least one valid contact (contact or contact2) is required",
      });
    }

    // Prepare base filter
    let filter = { incoming: true };

    // Build contact filter based on input
    if (contact && contact2 && !isNaN(contact) && !isNaN(contact2)) {
      filter.$or = [
        { farmerContact: Number(contact) },
        { farmerContact: Number(contact2) },
      ];
    } else if (contact && !isNaN(contact)) {
      filter.farmerContact = Number(contact);
    } else if (contact2 && !isNaN(contact2)) {
      filter.farmerContact = Number(contact2);
    }

    // Fetch data
    let incomingItemsData = await PickupItem.find(filter)
      .populate({
        path: "servicePerson",
        select: { _id: 0, name: 1 },
      })
      .sort({ pickupDate: -1 })
      .select("-servicePersonName -servicePerContact -__v -image")
      .lean();

    if (!incomingItemsData || !incomingItemsData.length) {
      return res.status(200).json({
        success: true,
        message: "No data found",
        data: [],
      });
    }

    // Format response
    const formattedData = incomingItemsData.map((item) => ({
      ...item,
      items: Array.isArray(item.items)
        ? item.items.map(({ _id, ...rest }) => rest)
        : [],
      pickupDate: item.pickupDate
        ? new Date(item.pickupDate).toISOString().split("T")[0]
        : null,
      arrivedDate: item.arrivedDate
        ? new Date(item.arrivedDate).toISOString().split("T")[0]
        : null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: formattedData,
    });
  } catch (error) {
    console.error("Error in showIncomingItemsFromFarmer:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showAllSystemInstallation = async (req, res) => {
  try {
    const allSystemInstallations = await NewSystemInstallation.find().select(
      "-referenceType -createdBy -__v",
    );
    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: allSystemInstallations || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.deductFromDefectiveOfItems = async (req, res) => {
  try {
    const { itemName, quantity, isRepaired } = req.query;

    // Validate required fields
    if (!itemName || !quantity) {
      return res.status(400).json({
        success: false,
        message: "itemName & quantity are required",
      });
    }

    const warehouseId = "67446a8b27dae6f7f4d985dd";

    // Find the warehouse items data by warehouseId
    const warehouseItemsData = await WarehouseItems.findOne({
      warehouse: warehouseId,
    });

    if (!warehouseItemsData) {
      return res.status(404).json({
        success: false,
        message: "Warehouse Items Data Not Found",
      });
    }

    // Check if itemName exists in the warehouse items
    const itemIndex = warehouseItemsData.items.findIndex(
      (item) => item.itemName === itemName,
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item Not Found In Warehouse",
      });
    }

    // Get the item based on the found index
    const itemToUpdate = warehouseItemsData.items[itemIndex];

    // Parse the quantity to be deducted
    const quantityToUpdate = parseInt(quantity);

    // Check if defective stock is enough before reducing
    if (itemToUpdate.defective < quantityToUpdate) {
      return res.status(400).json({
        success: false,
        message: `Insufficient defective stock. Available defective stock: ${itemToUpdate.defective}`,
      });
    }

    // Update quantities based on the isRepaired flag
    if (isRepaired === "true") {
      itemToUpdate.defective =
        parseInt(itemToUpdate.defective) - parseInt(quantityToUpdate);
      itemToUpdate.quantity =
        parseInt(itemToUpdate.quantity) + parseInt(quantityToUpdate);
      itemToUpdate.repaired =
        parseInt(itemToUpdate.repaired) + parseInt(quantityToUpdate);
    } else {
      itemToUpdate.defective =
        parseInt(itemToUpdate.defective) - parseInt(quantityToUpdate);
      itemToUpdate.rejected =
        parseInt(itemToUpdate.rejected) + parseInt(quantityToUpdate);
    }

    // Save the updated warehouse items data
    await warehouseItemsData.save();

    return res.status(200).json({
      success: true,
      message: "Item defective count updated successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

//---------------- Third Party Service Controller -----------------------//

module.exports.addOutgoingItemsData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      fromWarehouse,
      toServiceCenter,
      farmers,
      driverName,
      driverContact,
      vehicleNumber,
    } = req.body;

    // 🔹 Step 1: Validate required fields
    if (
      !fromWarehouse ||
      !toServiceCenter ||
      !farmers ||
      !driverName ||
      !driverContact ||
      !vehicleNumber
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "fromWarehouse, toServiceCenter, farmers, driver name, driver contact and vehicle number are required.",
      });
    }

    if (!Array.isArray(farmers) || farmers.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "farmers should be a non-empty array.",
      });
    }

    // 🔹 Step 2: Fetch warehouse inventory
    const warehouseItemsData = await WarehouseItems.findOne({
      warehouse: req.user.warehouse,
    }).session(session);

    if (!warehouseItemsData) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Warehouse Items Data Not Found.",
      });
    }

    // 🔹 Step 3: Validate each farmer's items
    for (const farmer of farmers) {
      if (
        !farmer.farmerSaralId ||
        !Array.isArray(farmer.items) ||
        farmer.items.length === 0
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message:
            "Each farmer must have a farmerSaralId and a non-empty items array.",
        });
      }

      for (const item of farmer.items) {
        const existingItem = warehouseItemsData.items.find(
          (i) => i.itemName === item.itemName,
        );

        if (!existingItem) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: `Item '${item.itemName}' not found in warehouse.`,
          });
        }

        if (existingItem.defective < item.quantity) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Insufficient defective stock for '${item.itemName}'. Available: ${existingItem.defective}, Requested: ${item.quantity}.`,
          });
        }

        // 🔹 Deduct defective stock
        existingItem.defective -= parseInt(item.quantity);
      }
    }

    // 🔹 Step 4: Save updated warehouse stock
    await warehouseItemsData.save({ session });

    // 🔹 Step 5: Create OutgoingItems record with "Pending" status
    const newOutgoing = new OutgoingItems({
      fromWarehouse,
      toServiceCenter,
      farmers,
      sendingDate: new Date(),
      status: "Pending", // ✅ status now tracked here
      driverName,
      driverContact,
      vehicleNumber,
      createdBy: req.user._id,
      createdAt: new Date(),
    });

    await newOutgoing.save({ session });

    // 🔹 Step 6: Commit transaction
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Outgoing items recorded and warehouse updated successfully.",
      data: newOutgoing,
    });
  } catch (error) {
    // 🔹 Rollback on error
    await session.abortTransaction();
    session.endSession();
    console.error("Error in addOutgoingItemsData:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.showOutgoingItemsData = async (req, res) => {
  try {
    const warehouseId = req.user.warehouse;

    // 🔹 Validate warehouse ID
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse ID not found in user data.",
      });
    }

    // 🔹 Check if warehouse exists
    const warehouseData = await Warehouse.findById(warehouseId);
    if (!warehouseData) {
      return res.status(404).json({
        success: false,
        message: "Warehouse not found.",
      });
    }

    // 🔹 Fetch outgoing items
    const outgoingItemsData = await OutgoingItems.find({
      fromWarehouse: warehouseData.warehouseName,
    }).sort({ sendingDate: -1 });

    if (!outgoingItemsData || outgoingItemsData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No outgoing items found for this warehouse.",
      });
    }

    const cleanedData = [];

    for (const doc of outgoingItemsData) {
      const docObj = doc.toObject();

      // 🔹 Find all receiving batches for this outgoing record
      const receivingBatches = await ReceivingItems.find({
        outgoingId: docObj._id,
      });

      // 🔹 Create map of received quantities for comparison
      const receivedMap = {};
      receivingBatches.forEach((batch) => {
        batch.farmers.forEach((farmer) => {
          if (!receivedMap[farmer.farmerSaralId])
            receivedMap[farmer.farmerSaralId] = {};
          farmer.receivedItems.forEach((item) => {
            if (!receivedMap[farmer.farmerSaralId][item.itemName])
              receivedMap[farmer.farmerSaralId][item.itemName] = 0;
            receivedMap[farmer.farmerSaralId][item.itemName] += item.quantity;
          });
        });
      });

      // 🔹 Check each farmer’s items and determine item-level + farmer-level receive status
      const farmersWithStatus = docObj.farmers.map((farmer) => {
        let farmerFullyReceived = true;

        const updatedItems = farmer.items.map((item) => {
          const receivedQty =
            receivedMap[farmer.farmerSaralId]?.[item.itemName] || 0;

          const isFullyReceived = receivedQty >= item.quantity;

          if (!isFullyReceived) farmerFullyReceived = false;

          return {
            ...item,
            receivedQuantity: receivedQty,
            isFullyReceived, // ✅ item-level status
          };
        });

        return {
          ...farmer,
          items: updatedItems,
          fullyReceived: farmerFullyReceived, // ✅ farmer-level status
        };
      });

      cleanedData.push({
        _id: docObj._id,
        fromWarehouse: warehouseData.warehouseName,
        toServiceCenter: docObj.toServiceCenter || null,
        status: docObj.status,
        sendingDate: docObj.sendingDate,
        farmers: farmersWithStatus,
        driverName: docObj.driverName,
        driverContact: docObj.driverContact,
        vehicleNumber: docObj.vehicleNumber,
        createdAt: docObj.createdAt,
      });
    }

    // ✅ Success response
    return res.status(200).json({
      success: true,
      message: "Outgoing items fetched successfully with receiving status.",
      data: cleanedData,
    });
  } catch (error) {
    console.error("Error in showOutgoingItemsData:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addReceivingItemsData = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      outgoingId,
      farmers,
      remarks,
      driverName,
      driverContact,
      vehicleNumber,
    } = req.body;
    const warehouseId = req.user?.warehouse;

    // 🔹 Step 1: Basic validation
    if (
      !outgoingId ||
      !Array.isArray(farmers) ||
      farmers.length === 0 ||
      !warehouseId ||
      !driverName ||
      !driverContact ||
      !vehicleNumber
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "outgoingId, warehouseId, farmers saralId, driver name, driver contact and vehicle number are required.",
      });
    }

    // 🔹 Step 2: Fetch outgoing record
    const outgoing = await OutgoingItems.findById(outgoingId).session(session);
    if (!outgoing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Outgoing record not found.",
      });
    }

    if (outgoing.status === "Fully Received") {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message:
          "Status - Fully Received for the outgoing record. Cannot accept any item for this record now.",
      });
    }

    // 🔹 Step 3: Validate each farmer and item exist in outgoing
    for (const farmer of farmers) {
      const outgoingFarmer = outgoing.farmers.find(
        (f) => f.farmerSaralId === farmer.farmerSaralId,
      );

      if (!outgoingFarmer) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `FarmerSaralId '${farmer.farmerSaralId}' not found in outgoing record.`,
        });
      }

      for (const recvItem of farmer.receivedItems) {
        const outItem = outgoingFarmer.items.find(
          (i) => i.itemName.toLowerCase() === recvItem.itemName.toLowerCase(),
        );

        if (!outItem) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Item '${recvItem.itemName}' not found for farmer '${farmer.farmerSaralId}' in outgoing record.`,
          });
        }
      }
    }

    // 🔹 Step 4: Find warehouse
    const warehouse = await WarehouseItems.findOne({
      warehouse: warehouseId,
    }).session(session);
    if (!warehouse) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Warehouse not found in WarehouseItems collection.",
      });
    }

    // 🔹 Step 5: Ensure all received items exist in warehouse
    for (const farmer of farmers) {
      for (const recvItem of farmer.receivedItems) {
        const itemInWarehouse = warehouse.items.find(
          (i) => i.itemName.toLowerCase() === recvItem.itemName.toLowerCase(),
        );

        if (!itemInWarehouse) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Item '${recvItem.itemName}' not found in warehouse '${warehouseId}'. Please ensure this item exists before receiving.`,
          });
        }
      }
    }

    // 🔹 Step 5.5: Prevent duplicate receiving for already fully received items
    const previousReceivings = await ReceivingItems.find({
      outgoingId,
    }).session(session);

    // Build cumulative map
    const totalReceivedMap = {};
    outgoing.farmers.forEach((farmer) => {
      totalReceivedMap[farmer.farmerSaralId] = {};
      farmer.items.forEach((item) => {
        totalReceivedMap[farmer.farmerSaralId][item.itemName.toLowerCase()] = 0;
      });
    });

    // Add all previous received quantities
    previousReceivings.forEach((rec) => {
      rec.farmers.forEach((farmerRec) => {
        farmerRec.receivedItems.forEach((recvItem) => {
          const key = recvItem.itemName.toLowerCase();
          if (
            totalReceivedMap[farmerRec.farmerSaralId] &&
            totalReceivedMap[farmerRec.farmerSaralId][key] !== undefined
          ) {
            totalReceivedMap[farmerRec.farmerSaralId][key] += recvItem.quantity;
          }
        });
      });
    });

    // Validate that new items don’t exceed remaining quantity
    for (const farmer of farmers) {
      const outgoingFarmer = outgoing.farmers.find(
        (f) => f.farmerSaralId === farmer.farmerSaralId,
      );
      if (!outgoingFarmer) continue;

      for (const recvItem of farmer.receivedItems) {
        const outItem = outgoingFarmer.items.find(
          (i) => i.itemName.toLowerCase() === recvItem.itemName.toLowerCase(),
        );
        if (!outItem) continue;

        const alreadyReceived =
          totalReceivedMap[farmer.farmerSaralId][
            recvItem.itemName.toLowerCase()
          ] || 0;
        const remainingQty = outItem.quantity - alreadyReceived;

        if (remainingQty <= 0) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `All units of '${recvItem.itemName}' for farmer '${farmer.farmerSaralId}' have already been received. Cannot receive again.`,
          });
        }

        if (recvItem.quantity > remainingQty) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Received quantity (${recvItem.quantity}) exceeds remaining (${remainingQty}) for '${recvItem.itemName}' (Farmer: ${farmer.farmerSaralId}).`,
          });
        }
      }
    }

    // 🔹 Step 6: Create receiving record
    const receiving = new ReceivingItems({
      outgoingId,
      farmers,
      remarks,
      driverName,
      driverContact,
      vehicleNumber,
    });
    await receiving.save({ session });

    // 🔹 Step 7: Update warehouse stock
    for (const farmer of farmers) {
      for (const recvItem of farmer.receivedItems) {
        const warehouseItem = warehouse.items.find(
          (i) => i.itemName.toLowerCase() === recvItem.itemName.toLowerCase(),
        );
        warehouseItem.quantity += recvItem.quantity;
      }
    }
    await warehouse.save({ session });

    // 🔹 Step 8: Recalculate total received quantities and outgoing status
    const allReceivings = await ReceivingItems.find({ outgoingId }).session(
      session,
    );

    const receivedMap = {};
    outgoing.farmers.forEach((farmer) => {
      receivedMap[farmer.farmerSaralId] = {};
      farmer.items.forEach((item) => {
        receivedMap[farmer.farmerSaralId][item.itemName] = 0;
      });
    });

    allReceivings.forEach((rec) => {
      rec.farmers.forEach((farmerRec) => {
        if (!receivedMap[farmerRec.farmerSaralId]) return;
        farmerRec.receivedItems.forEach((recvItem) => {
          if (
            receivedMap[farmerRec.farmerSaralId][recvItem.itemName] !==
            undefined
          ) {
            receivedMap[farmerRec.farmerSaralId][recvItem.itemName] +=
              recvItem.quantity;
          }
        });
      });
    });

    let fullyReceived = true;
    for (const outgoingFarmer of outgoing.farmers) {
      for (const outItem of outgoingFarmer.items) {
        const totalReceived =
          receivedMap[outgoingFarmer.farmerSaralId][outItem.itemName] || 0;
        if (totalReceived < outItem.quantity) {
          fullyReceived = false;
          break;
        }
      }
    }

    outgoing.status = fullyReceived ? "Fully Received" : "Partially Received";
    outgoing.updatedAt = new Date();
    outgoing.updatedBy = req.user?._id;
    await outgoing.save({ session });

    // 🔹 Step 9: Commit transaction
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `Items received successfully (${outgoing.status}). Warehouse stock updated.`,
      data: receiving,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Error receiving items:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

module.exports.receivingDataGroupedByOutgoing = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouse;

    const warehouseData = await Warehouse.findById(warehouseId);
    if (!warehouseData) {
      return res
        .status(404)
        .json({ success: false, message: "Warehouse Not Found." });
    }

    // Fetch all receiving records with outgoing info
    let receivingRecords = await ReceivingItems.find()
      .populate({
        path: "outgoingId",
        match: { fromWarehouse: warehouseData.warehouseName },
        select:
          "fromWarehouse toServiceCenter farmers receivedDate driverName driverContact vehicleNumber",
      })
      .sort({ receivedDate: -1 });

    receivingRecords = receivingRecords.filter((rec) => rec.outgoingId);

    if (receivingRecords.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No receiving records found." });
    }

    const groupedData = {};

    receivingRecords.forEach((rec) => {
      const outgoingId = rec.outgoingId._id.toString();

      if (!groupedData[outgoingId]) {
        groupedData[outgoingId] = {
          outgoingId,
          fromWarehouse: rec.outgoingId.fromWarehouse,
          toServiceCenter: rec.outgoingId.toServiceCenter,
          sendingDate: rec.outgoingId.sendingDate,
          farmers: {},
          receivingBatches: [],
          summary: {
            totalFarmers: 0,
            totalItems: 0,
            totalQuantitySent: 0,
            totalQuantityReceived: 0,
            totalQuantityPending: 0,
          },
        };

        // Initialize farmers/items
        if (Array.isArray(rec.outgoingId.farmers)) {
          rec.outgoingId.farmers.forEach((farmer) => {
            groupedData[outgoingId].farmers[farmer.farmerSaralId] = {
              items: {},
            };
            if (Array.isArray(farmer.items)) {
              farmer.items.forEach((item) => {
                groupedData[outgoingId].farmers[farmer.farmerSaralId].items[
                  item.itemName
                ] = {
                  quantity: item.quantity || 0,
                  receivedQuantity: 0,
                  pendingQuantity: item.quantity || 0,
                };
                groupedData[outgoingId].summary.totalItems += 1;
                groupedData[outgoingId].summary.totalQuantitySent +=
                  item.quantity || 0;
              });
            }
          });
          groupedData[outgoingId].summary.totalFarmers = Object.keys(
            groupedData[outgoingId].farmers,
          ).length;
        }
      }

      // Add receiving batch
      groupedData[outgoingId].receivingBatches.push({
        receivingId: rec._id,
        farmersReceived: rec.farmers || [],
        remarks: rec.remarks || "",
        driverName: rec.driverName,
        driverContact: rec.driverContact,
        vehicleNumber: rec.vehicleNumber,
        receivedDate: rec.receivedDate,
      });

      // Accumulate received quantities
      if (Array.isArray(rec.farmers)) {
        rec.farmers.forEach((farmerReceived) => {
          const farmerData =
            groupedData[outgoingId].farmers[farmerReceived.farmerSaralId];
          if (!farmerData || !Array.isArray(farmerReceived.receivedItems))
            return;

          farmerReceived.receivedItems.forEach((recvItem) => {
            if (!recvItem?.itemName || typeof recvItem.quantity !== "number")
              return;

            const itemData = farmerData.items[recvItem.itemName];
            if (itemData) {
              itemData.receivedQuantity += recvItem.quantity;
              itemData.pendingQuantity = Math.max(
                itemData.quantity - itemData.receivedQuantity,
                0,
              );
            }
          });
        });
      }
    });

    // Flatten farmers/items and calculate summary
    const result = Object.values(groupedData)
      .map((outgoing) => {
        let totalReceived = 0;
        let totalPending = 0;
        let fullyReceived = true;
        let partiallyReceived = false;

        // Convert farmers object to array, keep only items received
        const farmersArray = Object.entries(outgoing.farmers)
          .map(([farmerId, farmerData]) => {
            const itemsArray = Object.entries(farmerData.items)
              .filter(([_, item]) => item.receivedQuantity > 0) // only received items
              .map(([itemName, item]) => {
                totalReceived += item.receivedQuantity;
                totalPending += item.pendingQuantity;

                if (item.receivedQuantity === 0) fullyReceived = false;
                if (
                  item.receivedQuantity > 0 &&
                  item.receivedQuantity < item.quantity
                ) {
                  fullyReceived = false;
                  partiallyReceived = true;
                }
                if (item.receivedQuantity === item.quantity)
                  partiallyReceived = true;

                return { itemName, ...item };
              });

            if (itemsArray.length === 0) return null; // skip farmer with no received items
            return { farmerSaralId: farmerId, items: itemsArray };
          })
          .filter((f) => f !== null); // remove nulls

        outgoing.farmers = farmersArray;
        outgoing.outgoingStatus = fullyReceived
          ? "Fully Received"
          : partiallyReceived
            ? "Partially Received"
            : "Pending";
        outgoing.summary.totalQuantityReceived = totalReceived;
        outgoing.summary.totalQuantityPending = totalPending;

        return outgoing;
      })
      .filter((out) => out.farmers.length > 0); // only outgoings with received items

    return res.status(200).json({
      success: true,
      message: "Receiving records grouped by outgoing fetched successfully.",
      data: result,
    });
  } catch (error) {
    console.error("❌ Error fetching grouped receiving data:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

//-------------------------------------------------------------------------//

module.exports.showWarehouseItemsData = async (req, res) => {
  try {
    const warehouseId = "67446a8b27dae6f7f4d985dd";
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "WarehouseId Not Found",
      });
    }
    //const warehouseItemsData = await WarehouseItems.find({warehouse: warehouseId});
    const warehouseItemsData = await WarehouseItems.aggregate([
      {
        $match: { warehouse: new mongoose.Types.ObjectId(warehouseId) },
      },
      {
        $project: {
          _id: 0,
          items: {
            $map: {
              input: "$items",
              as: "item",
              in: { itemName: "$$item.itemName" },
            },
          },
        },
      },
    ]);
    if (!warehouseItemsData) {
      return res.status(404).json({
        success: false,
        message: "Warehouse Items Data Not Found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: warehouseItemsData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// This is the one.. yahi hai.. ok thank you koi dikkat hoga to fir call karte hain

module.exports.uploadSystemSubItemsFromExcel = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Excel file is required",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    const createdBy = req.user._id; // assuming JWT-based auth adds this

    const systemItemMap = data.map((row) => ({
      systemId: row.systemId,
      systemItemId: row.systemItemId,
      quantity: row.quantity,
      createdBy,
    }));

    await SystemItemMap.insertMany(systemItemMap);

    return res.status(201).json({
      success: true,
      message: "Sub-items uploaded successfully",
      insertedCount: systemItemMap.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.updateSystemId = async (req, res) => {
  try {
    const { systemId } = req.query;
    if (!systemId) {
      return res.status(400).json({
        success: false,
        message: "SystemId Not Found",
      });
    }
    const systemData = await SystemItem.find({ systemId: systemId });
    if (!systemData) {
      return res.status(404).json({
        success: false,
        message: "System Data Not Found",
      });
    }

    systemData.map(async (system) => {
      system.systemId = "68145a57c633b11fd5905f70";
      await system.save();
    });
    return res.status(200).json({
      success: true,
      message: "SystemId Updated Successfully",
      data: systemData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.attachItemSubItem = async (req, res) => {
  try {
    const { systemId, systemItemId, subItemId } = req.body;
    if (!systemId || !systemItemId || !subItemId) {
      return res.status(400).json({
        success: false,
        message: "SystemItemId & SubItemId are required",
      });
    }
    const itemSubItemData = await ItemComponentMap.findOne({
      systemId: systemId,
      systemItemId: systemItemId,
      subItemId: subItemId,
    });
    if (itemSubItemData) {
      return res.status(400).json({
        success: false,
        message: "Item SubItem Data Already Exists",
      });
    }
    const newItemSubItemData = new ItemComponentMap({
      systemId: systemId,
      systemItemId,
      subItemId,
      createdBy: req.user._id,
    });
    const savedItemSubItemData = await newItemSubItemData.save();
    if (savedItemSubItemData) {
      return res.status(200).json({
        success: true,
        message: "Item SubItem Data Saved Successfully",
        data: savedItemSubItemData,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.uploadSystemItemsFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    if (!Array.isArray(data) || data.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Excel file is empty or invalid" });
    }

    const adminId = req.user?._id || "67446a4296f7ef394e784136";

    // Step 1: Add items to SystemItem
    const itemsToInsert = data
      .map((row) => ({
        itemName: row.itemName?.trim(),
        createdBy: adminId,
      }))
      .filter((item) => item.itemName);

    const insertedItems = await SystemItem.insertMany(itemsToInsert);

    // Step 2: Fetch all warehouses
    const warehouses = await Warehouse.find({}, "_id");

    // Step 3: Prepare and insert InstallationInventory records
    const inventoryRecords = [];

    insertedItems.forEach((item) => {
      warehouses.forEach((wh) => {
        inventoryRecords.push({
          warehouseId: wh._id,
          systemItemId: item._id,
          quantity: 0,
          createdBy: adminId,
        });
      });
    });

    await InstallationInventory.insertMany(inventoryRecords);

    res.status(201).json({
      success: true,
      message: `${insertedItems.length} items added and linked to all warehouses.`,
      data: insertedItems,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// add sub item in the bom
module.exports.attachItemComponentMapByExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Excel file is required" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const insertData = [];

    for (const row of data) {
      const { systemId, systemItemId, subItemId, quantity } = row;

      if (!systemId || !systemItemId || !subItemId) continue;

      const exists = await ItemComponentMap.findOne({
        systemId,
        systemItemId,
        subItemId,
      });
      if (!exists) {
        insertData.push({
          systemId,
          systemItemId,
          subItemId,
          quantity,
          createdBy: req.user._id,
        });
      }
    }

    const inserted = await ItemComponentMap.insertMany(insertData);

    return res.status(200).json({
      success: true,
      message: "Data inserted successfully",
      insertedCount: inserted.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.getSystemItemsWithSubItems = async (req, res) => {
  try {
    const { systemId } = req.query;

    // Step 1: Get all system items for the given system
    const systemItems = await SystemItemMap.find({ systemId })
      .populate({
        path: "systemItemId",
        select: {
          _id: 1,
          itemName: 1,
        },
      })
      .select("-createdAt -createdBy -__v");

    const result = [];

    // Step 2: For each system item, check for subitems
    for (const item of systemItems) {
      const subItems = await ItemComponentMap.find({
        systemId: systemId,
        systemItemId: item.systemItemId._id,
      })
        .populate({
          path: "subItemId",
          select: {
            _id: 1,
            itemName: 1,
          },
        })
        .select("-createdAt -createdBy -__v");

      result.push({
        systemItemId: item.systemItemId,
        quantity: item.quantity,
        createdBy: item.createdBy,
        subItems: subItems.map((sub) => ({
          subItemId: sub.subItemId,
          quantity: sub.quantity,
          createdBy: sub.createdBy,
        })),
      });
    }

    return res.status(200).json({
      success: true,
      message: "System Items with SubItems fetched successfully",
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.getSystemItemsFromItemComponentMap = async (req, res) => {
  const { systemId } = req.query;

  try {
    const items = await ItemComponentMap.find({ systemId }).populate({
      path: "systemItemId",
      select: "_id itemName",
    });

    if (!items || items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No system items found for the system",
      });
    }

    // Filter unique systemItemId
    const uniqueItemsMap = new Map();
    items.forEach((item) => {
      const id = item.systemItemId?._id?.toString();
      if (id && !uniqueItemsMap.has(id)) {
        uniqueItemsMap.set(id, {
          _id: item.systemItemId._id,
          itemName: item.systemItemId.itemName,
        });
      }
    });

    const uniqueItems = Array.from(uniqueItemsMap.values());

    // ✅ Custom sort for pumps (like "PUMP 3HP DC 30M")
    const sortedItems = uniqueItems.sort((a, b) => {
      const extractPumpInfo = (name) => {
        const match = name.match(/PUMP\s*(\d+)HP.*?(\d+)M/i);
        return match ? { hp: +match[1], head: +match[2] } : { hp: 0, head: 0 };
      };

      const aInfo = extractPumpInfo(a.itemName);
      const bInfo = extractPumpInfo(b.itemName);

      if (aInfo.hp !== bInfo.hp) return aInfo.hp - bInfo.hp; // Sort by HP first
      return aInfo.head - bInfo.head; // Then by Head (M)
    });

    res.status(200).json({
      success: true,
      message: "Unique system items fetched and sorted successfully",
      data: sortedItems,
    });
  } catch (error) {
    console.error("Error fetching items by systemId:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.updateInstallationInventoryFromExcel = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const results = [];
    const successList = [];
    const failedList = [];

    let successCount = 0;
    let failedCount = 0;

    for (const row of worksheet) {
      const { warehouseId, itemName, quantity } = row;

      if (!warehouseId || !itemName || quantity == null) {
        failedList.push({
          itemName,
          warehouseId,
          quantity,
          reason: "Missing required fields",
        });

        failedCount++;
        continue;
      }

      const escapedName = itemName
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const systemItem = await SystemItem.findOne({
        itemName: new RegExp(`^${escapedName}$`, "i"),
      });

      if (!systemItem) {
        failedList.push({
          itemName,
          warehouseId,
          quantity,
          reason: "SystemItem not found",
        });
        failedCount++;
        continue;
      }

      const inventory = await InstallationInventory.findOne({
        warehouseId,
        systemItemId: systemItem._id,
      });

      if (!inventory) {
        failedList.push({
          itemName,
          warehouseId,
          quantity,
          reason: "InstallationInventory not found",
        });
        failedCount++;
        continue;
      }

      inventory.quantity = quantity;
      inventory.updatedAt = new Date();
      await inventory.save();

      successList.push({
        itemName,
        warehouseId,
        quantity,
        status: "Updated successfully",
      });
      successCount++;
    }

    return res.status(200).json({
      success: true,
      message: "Inventory update completed",
      summary: {
        totalProcessed: successCount + failedCount,
        updated: successCount,
        failed: failedCount,
      },
      updatedItems: successList,
      failedItems: failedList,
    });
  } catch (error) {
    console.error("Error while updating inventory from Excel:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.declinePickupItemsTransaction = async (req, res) => {
  try {
    const { transactionId, remark } = req.body;

    if (!transactionId || !remark.trim()) {
      return res.status(400).json({
        success: false,
        message: "Incomplete Data",
      });
    }

    const existingData = await PickupItem.findOneAndUpdate(
      { _id: transactionId, status: null },
      {
        status: false,
        warehouseRemark: remark,
        declinedBy: req.user?.name,
        declineDate: new Date(),
      },
      { new: true },
    );

    if (!existingData) {
      return res.status(404).json({
        success: false,
        message: "Data Not Found or Already Processed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Transaction Declined Successfully",
      data: existingData,
    });
  } catch (error) {
    console.error("ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addSerialNumber = async (req, res) => {
  try {
    let { productType, serialNumber, state } = req.body;

    if (!productType || !serialNumber || !state) {
      return res.status(400).json({
        success: false,
        message: "Product type and serial number are required",
      });
    }

    productType = productType.trim().toLowerCase();
    const trimmedSerialNumber = serialNumber.trim().toUpperCase();

    // Check if serial number already exists
    const isExist = await SerialNumber.findOne({
      serialNumber: trimmedSerialNumber,
    }).lean();

    if (isExist) {
      return res.status(400).json({
        success: false,
        message: "Serial number already exists",
      });
    }

    // Create new document
    const newSerial = new SerialNumber({
      productType,
      serialNumber: trimmedSerialNumber,
      state,
      isUsed: false,
    });

    await newSerial.save();

    return res.status(201).json({
      success: true,
      message: "Serial number inserted successfully",
      data: newSerial,
    });
  } catch (error) {
    console.error("ERROR:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.getSerialNumber = async (req, res) => {
  try {
    const productType = req.query?.productType?.trim().toLowerCase();
    if (!productType) {
      return res.status(400).json({
        success: false,
        message: "Product Type is required",
      });
    }

    // Fetch all serial numbers for the given product type
    const serialNumbers = await SerialNumber.find(
      { productType },
      { _id: 0, serialNumber: 1, state: 1, isUsed: 1 },
    ).lean();

    if (!serialNumbers || serialNumbers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No serial numbers found for the given product type",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: serialNumbers,
    });
  } catch (error) {
    console.error("ERROR: ", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports.checkSerialNumber = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { productType, serialNumber, panelNumberList } = req.body;
    console.log("Received Data:", {
      productType,
      serialNumber,
      panelNumberList,
    });
    const trimmedProductType = productType
      ? String(productType).trim().toLowerCase()
      : null;
    const trimmedSerialNumber = serialNumber
      ? String(serialNumber).trim().toUpperCase()
      : null;
    console.log("Trimmed Data:", {
      trimmedProductType,
      trimmedSerialNumber,
      panelNumberList,
    });
    if (
      !trimmedProductType ||
      (!trimmedSerialNumber &&
        (!Array.isArray(panelNumberList) || panelNumberList.length === 0))
    ) {
      return res.status(400).json({
        success: false,
        message: "Product Type & Serial Number(s) are required",
      });
    }

    if (trimmedProductType === "rmu" && trimmedSerialNumber.length !== 15) {
      return res.status(400).json({
        success: false,
        message: "RMU Number must be exactly 15 characters long",
      });
    }

    const warehouseId = req.user.warehouse;

    // ✅ Fetch warehouse data
    const warehouseData = await Warehouse.findById(warehouseId);
    if (!warehouseData) {
      return res
        .status(404)
        .json({ success: false, message: "Warehouse Not Found" });
    }

    // ✅ Determine State
    let state;
    const whName = warehouseData.warehouseName;
    if (["Bhiwani"].includes(whName)) {
      state = "Haryana";
    } else if (whName === "Maharashtra Warehouse - Ambad") {
      state = "Maharashtra";
    } else if (whName === "Korba Chhattisgarh") {
      state = "Chhattisgarh";
    }
    console.log("Determined State:", state);

    // 🔹 CASE 1: Multiple Panel Numbers
    // 🔹 CASE 1: Multiple Panel Numbers
    if (Array.isArray(panelNumberList) && panelNumberList.length > 0) {
      const trimmedPanelNumbers = panelNumberList.map((num) =>
        String(num).trim().toUpperCase(),
      );

      // Find in SerialNumber collection
      const serials = await SerialNumber.find({
        productType: trimmedProductType,
        state,
        serialNumber: { $in: trimmedPanelNumbers },
      }).lean();

      // Find in FarmerItemsActivity collection
      const farmerActivity = await FarmerItemsActivity.find({
        panelNumbers: { $in: trimmedPanelNumbers },
        state,
      }).lean();

      if ((!serials || serials.length === 0) && farmerActivity.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No panel numbers found for this product type",
        });
      }

      // Extract FarmerActivity numbers (only those present in frontend input)
      const farmerActivityNumbers = farmerActivity
        .map((f) => f.panelNumbers)
        .flat()
        .filter((num) => trimmedPanelNumbers.includes(num));

      // Prepare used & unused lists (deduplicated)
      const usedSerials = [
        ...new Set([
          ...serials.filter((s) => s.isUsed).map((s) => s.serialNumber),
          ...farmerActivityNumbers,
        ]),
      ];

      const unusedSerials = [
        ...new Set(
          serials
            .filter(
              (s) =>
                !s.isUsed && !farmerActivityNumbers.includes(s.serialNumber),
            )
            .map((s) => s.serialNumber),
        ),
      ];

      return res.status(200).json({
        success: true,
        message: "Panel numbers checked successfully",
        data: {
          usedSerials,
          unusedSerials,
        },
      });
    }

    // Check in SerialNumber collection
    const existsSerial = await SerialNumber.findOne({
      productType: trimmedProductType,
      state,
      serialNumber: trimmedSerialNumber,
    }).lean();

    // Check in FarmerItemsActivity (for pump, motor, controller, rmu, panels)
    const existsInFarmerActivity = await FarmerItemsActivity.findOne({
      $or: [
        { pumpNumber: trimmedSerialNumber },
        { motorNumber: trimmedSerialNumber },
        { controllerNumber: trimmedSerialNumber },
        { rmuNumber: trimmedSerialNumber },
        { panelNumbers: trimmedSerialNumber },
        { extraPanelNumbers: trimmedSerialNumber },
      ],
    }).lean();

    if (!existsSerial && !existsInFarmerActivity) {
      return res.status(404).json({
        success: false,
        message: `Serial Number not found for this product type for ${state}`,
      });
    }

    // If found in FarmerItemsActivity → Already assigned
    if (existsInFarmerActivity) {
      return res.status(200).json({
        success: true,
        message: `Farmer Already Assigned - ${existsInFarmerActivity.farmerSaralId}`,
      });
    }

    // Else check SerialNumber.isUsed flag
    if (existsSerial && existsSerial.isUsed) {
      return res.status(200).json({
        success: true,
        message: "Already Dispatched",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Good to go",
    });
  } catch (error) {
    console.error("ERROR: ", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

module.exports.checkRMUNumber = async (req, res) => {
  try {
    const { productType, rmuNumber } = req.body;
    if (productType.trim().toLowerCase() !== "rmu" || !rmuNumber) {
      return res.status(400).json({
        success: false,
        message: "Product Type & RMU Number is required",
      });
    }

    const warehouseId = req.user.warehouse;
    const warehouseData = await Warehouse.findById(warehouseId);

    if (!warehouseData) {
      return res.status(404).json({
        success: false,
        message: "Warehouse Not Found",
      });
    }

    // ✅ State mapping
    const whName = warehouseData.warehouseName;
    let state;
    if (["Bhiwani"].includes(whName)) {
      state = "Haryana";
    } else if (whName === "Maharashtra Warehouse - Ambad") {
      state = "Maharashtra";
    } else if (whName === "Korba Chhattisgarh") {
      state = "Chhattisgarh";
    }

    const trimmedRMUNumber = rmuNumber.trim().toUpperCase();

    // ✅ Check in SerialNumber
    let existingRMU = await SerialNumber.findOne({
      productType: productType.trim().toLowerCase(),
      state,
      serialNumber: trimmedRMUNumber,
    });

    if (!existingRMU) {
      // Check in FarmerItemsActivity (already dispatched)
      const dispatchedSystem = await FarmerItemsActivity.findOne({
        rmuNumber: trimmedRMUNumber,
      });

      if (dispatchedSystem) {
        return res.status(400).json({
          success: false,
          message: `${state} - RMU Number ${trimmedRMUNumber} already dispatched.`,
        });
      }

      // If not found anywhere, create new SerialNumber
      existingRMU = new SerialNumber({
        productType: productType.trim().toLowerCase(),
        state,
        serialNumber: trimmedRMUNumber,
        isUsed: false, // keep available until actually dispatched
      });
      await existingRMU.save();

      return res.status(200).json({
        success: true,
        message: `RMU Number ${trimmedRMUNumber} registered & can be used.`,
      });
    }

    // ✅ If already exists but marked used
    if (existingRMU.isUsed) {
      return res.status(400).json({
        success: false,
        message: `${state} - RMU Number ${trimmedRMUNumber} already dispatched.`,
      });
    }

    return res.status(200).json({
      success: true,
      message: `RMU Number ${trimmedRMUNumber} can be used.`,
    });
  } catch (error) {
    console.error("ERROR in checkRMUNumber: ", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.uploadSerialNumbers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // Parse Excel buffer
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheetData.length) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty",
      });
    }

    const bulkInsertData = [];
    const duplicateRows = [];

    for (const row of sheetData) {
      // Convert values to string safely
      const productType = row.productType
        ? String(row.productType).trim().toLowerCase()
        : null;

      const serialNumber = row.serialNumber
        ? String(row.serialNumber).trim().toUpperCase()
        : null;

      const state = row.state ? String(row.state).trim() : null;
      if (!productType || !serialNumber) {
        duplicateRows.push({ ...row, reason: "Invalid data" });
        continue;
      }

      // Check if serial number already exists
      const exists = await SerialNumber.findOne({
        productType,
        serialNumber,
        state,
      }).lean();

      if (exists) {
        duplicateRows.push({ productType, serialNumber, reason: "Duplicate" });
      } else {
        bulkInsertData.push({
          productType,
          serialNumber,
          state,
          isUsed: false,
        });
      }
    }

    // Insert only valid unique serial numbers
    if (bulkInsertData.length > 0) {
      await SerialNumber.insertMany(bulkInsertData);
    }

    // If duplicates exist, generate an Excel file
    if (duplicateRows.length > 0) {
      const newWB = XLSX.utils.book_new();
      const newWS = XLSX.utils.json_to_sheet(duplicateRows);
      XLSX.utils.book_append_sheet(newWB, newWS, "Duplicates");

      const filePath = path.join(__dirname, "../../uploads/duplicates.xlsx");
      XLSX.writeFile(newWB, filePath);

      return res.download(filePath, "Duplicates_SerialNumber.xlsx", (err) => {
        if (err) {
          console.error("Download error:", err);
        }
        // optionally remove file after download
        fs.unlinkSync(filePath);
      });
    }

    return res.status(200).json({
      success: true,
      message: `${bulkInsertData.length} Serial Numbers Uploaded Successfully. No duplicates found.`,
    });
  } catch (error) {
    console.error("ERROR:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports.updateSerialNumbersAsUsed = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // Parse Excel buffer
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheetData.length) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty",
      });
    }

    const failedRows = [];
    let updatedCount = 0;

    // Build bulk operations
    const bulkOps = sheetData
      .map((row) => {
        const productType = row.productType
          ? String(row.productType).trim().toLowerCase()
          : null;

        const serialNumber = row.serialNumber
          ? String(row.serialNumber).trim().toUpperCase()
          : null;

        const state = row.state ? String(row.state).trim() : null;

        if (!productType || !serialNumber) {
          failedRows.push({ ...row, reason: "Invalid data" });
          return null;
        }

        return {
          updateOne: {
            filter: { productType, serialNumber },
            update: { $set: { isUsed: true } },
          },
        };
      })
      .filter(Boolean); // remove nulls

    // Run bulkWrite in one go
    if (bulkOps.length > 0) {
      const result = await SerialNumber.bulkWrite(bulkOps, { ordered: false });
      updatedCount = result.modifiedCount;
    }

    // If there are failed rows, export them into an Excel
    if (failedRows.length > 0) {
      const newWB = XLSX.utils.book_new();
      const newWS = XLSX.utils.json_to_sheet(failedRows);
      XLSX.utils.book_append_sheet(newWB, newWS, "Failed Updates");

      const filePath = path.join(
        __dirname,
        "../../uploads/failed_updates.xlsx",
      );
      XLSX.writeFile(newWB, filePath);

      return res.download(filePath, "failed_updates.xlsx", (err) => {
        if (err) {
          console.error("Download error:", err);
        }
        // remove after download
        fs.unlinkSync(filePath);
      });
    }

    return res.status(200).json({
      success: true,
      message: `${updatedCount} Serial Numbers updated successfully. No failures.`,
    });
  } catch (error) {
    console.error("ERROR:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports.updateIncomingPickupItemSerial = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId, updatedSerialNumber } = req.body;
    const empRole = req.user?.role;
    console.log(transactionId, updatedSerialNumber);
    // Role check
    if (empRole !== "warehouseAdmin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: "Only warehouse person is allowed to update",
      });
    }

    // Input validation
    if (!transactionId || !updatedSerialNumber) {
      await session.abortTransaction();
      session.endSession();
      return res.status(422).json({
        success: false,
        message: "transactionId and updatedSerialNumber are required",
      });
    }

    // Normalize serial number
    const normalizedSerial = updatedSerialNumber.trim().toUpperCase();

    // Check uniqueness inside transaction
    const existingSerial = await PickupItem.findOne(
      { updatedSerialNumber: normalizedSerial, incoming: true },
      null,
      { session },
    );
    if (existingSerial) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: "This serial number is already in use",
      });
    }
    console.log("Hi");
    // Update document atomically
    const updatedPickupItem = await PickupItem.findOneAndUpdate(
      { _id: transactionId, incoming: true },
      {
        $set: {
          updatedSerialNumber: normalizedSerial,
          updatedBy: req.user?._id,
          updatedAt: new Date(),
        },
      },
      { new: true, session },
    );
    console.log(updatedPickupItem);
    if (!updatedPickupItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: `Incoming PickupItem with id ${transactionId} not found`,
      });
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "PickupItem updated successfully",
      data: updatedPickupItem,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error updating PickupItem:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.updateOutogingItemFarmerDetails = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      transactionId,
      farmerName,
      farmerContact,
      farmerVillage,
      farmerComplaintId,
      farmerSaralId,
    } = req.body;

    if (!transactionId) {
      return res.status(422).json({
        success: false,
        message: "transactionId is required",
      });
    }

    if (req?.user?.role !== "warehouseAdmin") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Only warehouse person is allowed to update.",
      });
    }
    const verifyOutgoingItem = await PickupItem.findOne({
      _id: transactionId,
      incoming: false,
    });

    if (!verifyOutgoingItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Outgoing Item Data Not Found",
      });
    }

    // Build update object dynamically (only provided fields will update)
    const updateFields = {};
    if (farmerName) updateFields.farmerName = farmerName.trim();
    if (farmerContact) updateFields.farmerContact = farmerContact;
    if (farmerVillage) updateFields.farmerVillage = farmerVillage.trim();
    if (farmerComplaintId) updateFields.farmerComplaintId = farmerComplaintId;
    if (farmerSaralId) updateFields.farmerSaralId = farmerSaralId.trim();
    updateFields.updatedAt = new Date();
    updateFields.updatedBy = req.user?._id;

    const updatedPickupItem = await PickupItem.findByIdAndUpdate(
      transactionId,
      { $set: updateFields },
      { new: true, session },
    );

    if (!updatedPickupItem) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: `PickupItem with id ${transactionId} not found`,
      });
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Farmer details updated successfully",
      data: updatedPickupItem,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error updating farmer details:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addMotorNumbersFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // Parse Excel buffer
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // 2. Loop through Excel rows
    for (const row of sheetData) {
      const { farmerSaralId, motorNumber } = row;

      // Skip if motorNumber is empty
      if (!motorNumber || motorNumber.trim() === "") {
        console.log(
          `⏭ Skipping row for farmerSaralId ${farmerSaralId} (empty motorNumber)`,
        );
        continue;
      }

      // 3. Update only if motorNumber is not already present
      const updated = await FarmerItemsActivity.updateOne(
        {
          farmerSaralId,
          $or: [{ motorNumber: { $exists: false } }, { motorNumber: "" }],
        },
        { $set: { motorNumber: motorNumber.toUpperCase().trim() } },
      );

      if (updated.modifiedCount > 0) {
        console.log(
          `✅ Updated motorNumber for farmerSaralId ${farmerSaralId}`,
        );
      } else {
        console.log(
          `⚠️ Skipped farmerSaralId ${farmerSaralId} (already has motorNumber or not found)`,
        );
      }
    }

    console.log("🎉 Update process completed!");
  } catch (error) {
    console.error("❌ Error updating motorNumbers:", error);
  }
};

module.exports.exportMotorNumbersExcel = async (req, res) => {
  try {
    // Fetch only motorNumbers where state = Maharashtra
    const records = await FarmerItemsActivity.find(
      { state: "Maharashtra" },
      { motorNumber: 1, _id: 0 },
    ).lean();

    if (!records.length) {
      return res.status(404).json({
        success: false,
        message: "No motor numbers found for Maharashtra",
      });
    }

    // Create workbook & worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("MotorNumbers");

    // Define header
    worksheet.columns = [
      { header: "Motor Number", key: "motorNumber", width: 30 },
    ];

    // Insert rows
    records.forEach((record) => {
      worksheet.addRow({ motorNumber: record.motorNumber });
    });

    // Set response headers for file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=motorNumbers_maharashtra.xlsx",
    );

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error exporting motor numbers:", error);
    res.status(500).json({
      success: false,
      message: "Error generating Excel file",
      error: error.message,
    });
  }
};

// module.exports.importDispatchedSystemExcelData = async (req, res) => {
//   try {
//     if (!req.file || !req.file.buffer) {
//       return res.status(400).json({ message: "Please upload an Excel file" });
//     }

//     // Parse Excel
//     const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
//     const sheetName = workbook.SheetNames[0];
//     const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     const farmerActivityDocs = [];
//     const employeeAssignedDocs = [];
//     const serialNumbersToUpdate = [];
//     const failedRows = [];

//     for (let row of rows) {
//       try {
//         // --- System check ---
//         const system = await System.findOne({ systemName: row.systemName });
//         console.log("System: ", system);
//         if (!system) {
//           failedRows.push({ ...row, reason: "System not found" });
//           continue;
//         }

//         // --- Employee check ---
//         console.log("Employee Name", row.employeeName);
//         const empData = await ServicePerson.findOne({
//           name: new RegExp("^" + row.employeeName.trim() + "$", "i"),
//           state: new RegExp("^" + row.state.trim() + "$", "i"),
//         });

//         console.log("EMP: ", empData);
//         if (!empData) {
//           failedRows.push({ ...row, reason: "Employee not found" });
//           continue;
//         }

//         // --- Mandatory numbers check ---
//         if (!row.pumpNumber || !row.controllerNumber || !row.rmuNumber) {
//           failedRows.push({
//             ...row,
//             reason: "Missing pump/controller/rmu number",
//           });
//           continue;
//         }

//         const existingActivity = await FarmerItemsActivity.findOne({
//           farmerSaralId: row.farmerSaralId,
//           state: row.state,
//         });
//         console.log("Exist Farmer Activity: ", existingActivity);
//         if (existingActivity) {
//           failedRows.push({
//             ...row,
//             reason: `FarmerSaralId ${row.farmerSaralId} already exists in FarmerItemsActivity`,
//           });
//           continue;
//         }

//         // --- Collect serial numbers (panels flexible) ---
//         const panelNumbers = ["panel1", "panel2", "panel3", "panel4", "panel5", "panel6", "panel7", "panel8", "panel9", "panel10", "panel11", "panel12", "panel13"]
//           .map((p) => row[p]?.toString().trim().toUpperCase())
//           .filter(Boolean);

//         const pumpNumber = row.pumpNumber.toString().trim().toUpperCase();
//         const controllerNumber = row.controllerNumber
//           .toString()
//           .trim()
//           .toUpperCase();
//         const rmuNumber = row.rmuNumber.toString().trim().toUpperCase();

//         const serialNumbers = [
//           ...panelNumbers,
//           pumpNumber,
//           controllerNumber,
//           rmuNumber,
//         ];
//         console.log("SerialNumbers: ", serialNumbers);
//         // --- Validate serial numbers ---
//         const existingSerials = await SerialNumber.find({
//           serialNumber: { $in: serialNumbers },
//           state: row.state,
//         })
//           .select("serialNumber")
//           .lean();

//         const existingSet = new Set(existingSerials.map((s) => s.serialNumber));
//         const missingSerials = serialNumbers.filter(
//           (sn) => !existingSet.has(sn)
//         );

//         if (missingSerials.length > 0) {
//           failedRows.push({
//             ...row,
//             reason: `Missing serial numbers: ${missingSerials.join(", ")}`,
//           });
//           continue;
//         }

//         // --- Check serialNumbers already used in FarmerItemsActivity ---
//         const serialsAlreadyUsed = await FarmerItemsActivity.findOne({
//           $or: [
//             { pumpNumber: { $in: serialNumbers } },
//             { controllerNumber: { $in: serialNumbers } },
//             { rmuNumber: { $in: serialNumbers } },
//             { panelNumbers: { $in: serialNumbers } },
//           ],
//           state: row.state,
//         });

//         if (serialsAlreadyUsed) {
//           failedRows.push({
//             ...row,
//             reason: `Some serial numbers already used in FarmerItemsActivity: ${serialsAlreadyUsed.farmerSaralId}`,
//           });
//           continue;
//         }

//         // --- Build items list ---
//         const systemItems = await SystemItemMap.find({
//           systemId: system._id,
//         }).populate("systemItemId");
//         let itemsList = [];

//         for (let si of systemItems) {
//           const isPump = si.systemItemId?.itemName
//             .toLowerCase()
//             .includes("pump");
//             console.log("isPump: ", isPump);

//           if (isPump) {
//             // Only include correct pump variant
//             if (si.systemItemId?.itemName === row.pumpHead) {
//               console.log("Pump Data: ", si.systemItemId?.itemName);
//               itemsList.push({
//                 systemItemId: si.systemItemId._id,
//                 quantity: si.quantity,
//               });

//               // Fetch sub-items for this pump
//               const components = await ItemComponentMap.find({
//                 systemId: system._id,
//                 systemItemId: si.systemItemId._id,
//               }).populate("systemItemId");
//               console.log(components);
//               for (let comp of components) {
//                 itemsList.push({
//                   systemItemId: comp.subItemId,
//                   quantity: comp.quantity,
//                 });
//               }
//             }
//           } else {
//             itemsList.push({
//               systemItemId: si.systemItemId._id,
//               quantity: si.quantity,
//             });
//           }
//         }
//         console.log("systemId: ", system._id);
//         console.log("itemsList: ", itemsList);
//         // --- Prepare documents ---
//         farmerActivityDocs.push({
//           referenceType: "ServicePerson",
//           warehouseId: new mongoose.Types.ObjectId("67beef9e2fffc2145da032f3"),
//           farmerSaralId: row.farmerSaralId,
//           empId: empData._id,
//           systemId: system._id,
//           itemsList,
//           extraItemsList: [],
//           panelNumbers,
//           extraPanelNumbers: [],
//           pumpNumber,
//           motorNumber: "",
//           controllerNumber,
//           rmuNumber,
//           state: row.state,
//           accepted: false,
//           installationDone: false,
//           createdBy: new mongoose.Types.ObjectId("679b10c19cffe98b71683bc5"),
//           sendingDate: new Date(),
//           createdAt: new Date(),
//         });

//         employeeAssignedDocs.push({
//           referenceType: "ServicePerson",
//           warehouseId: new mongoose.Types.ObjectId("67beef9e2fffc2145da032f3"),
//           empId: empData._id,
//           farmerSaralId: row.farmerSaralId,
//           systemId: system._id,
//           itemsList,
//           extraItemsList: [],
//           createdBy: new mongoose.Types.ObjectId("679b10c19cffe98b71683bc5"),
//           createdAt: new Date(),
//         });

//         // --- Collect serials for update ---
//         serialNumbers.forEach((sn) =>
//           serialNumbersToUpdate.push({ serialNumber: sn, state: row.state })
//         );
//       } catch (innerErr) {
//         failedRows.push({
//           ...row,
//           reason: `Unexpected error: ${innerErr.message}`,
//         });
//       }
//     }
//     console.log("Farmer Activity Length: ", farmerActivityDocs.length);
//     console.log("Installation Assign Emp: ", employeeAssignedDocs.length);
//     console.log("New Farmer Activittes: ", farmerActivityDocs);
//     console.log("New Assigned Emp: ", employeeAssignedDocs);
//     // --- Insert valid rows ---
//     if (farmerActivityDocs.length > 0) {
//       await FarmerItemsActivity.insertMany(farmerActivityDocs);
//     }
//     if (employeeAssignedDocs.length > 0) {
//       await InstallationAssignEmp.insertMany(employeeAssignedDocs);
//     }

//     // --- Mark serial numbers as used ---
//     if (serialNumbersToUpdate.length > 0) {
//       const bulkOps = serialNumbersToUpdate.map((sn) => ({
//         updateOne: {
//           filter: { serialNumber: sn.serialNumber, state: sn.state },
//           update: { $set: { isUsed: true } },
//           upsert: false,
//         },
//       }));
//       await SerialNumber.bulkWrite(bulkOps);
//     }

//     // --- If any rows failed, return an Excel ---
//     if (failedRows.length > 0) {
//       const ws = XLSX.utils.json_to_sheet(failedRows);
//       const wb = XLSX.utils.book_new();
//       XLSX.utils.book_append_sheet(wb, ws, "FailedRows");
//       const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

//       res.setHeader(
//         "Content-Disposition",
//         "attachment; filename=Failed_Rows.xlsx"
//       );
//       res.setHeader(
//         "Content-Type",
//         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
//       );
//       return res.send(excelBuffer);
//     }

//     return res.status(200).json({
//       sucess: true,
//       message: "Excel data imported successfully",
//       recordsProcessed: farmerActivityDocs.length,
//     });
//   } catch (err) {
//     console.error(err);
//     return res
//       .status(500)
//       .json({ status: false, message: "Server error", error: err.message });
//   }
// };

module.exports.importDispatchedSystemExcelData = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "Please upload an Excel file" });
    }

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const farmerActivityDocs = [];
    const employeeAssignedDocs = [];
    const serialNumbersToUpdate = [];
    const failedRows = [];

    for (let row of rows) {
      try {
        // --- System check ---
        const system = await System.findOne({ systemName: row.systemName });
        if (!system) {
          failedRows.push({ ...row, reason: "System not found" });
          continue;
        }

        // --- Employee check ---
        const empData = await ServicePerson.findOne({
          name: new RegExp("^" + row.employeeName.trim() + "$", "i"),
          state: new RegExp("^" + row.state.trim() + "$", "i"),
        });
        if (!empData) {
          failedRows.push({ ...row, reason: "Employee not found" });
          continue;
        }

        // // --- Mandatory numbers check ---
        // if (!row.pumpNumber || !row.controllerNumber || !row.rmuNumber) {
        //   failedRows.push({
        //     ...row,
        //     reason: "Missing pump/controller/rmu number",
        //   });
        //   continue;
        // }

        // // --- Collect serial numbers (panels flexible up to 13) ---
        // const panelNumbers = Array.from(
        //   { length: 13 },
        //   (_, i) => "panel" + (i + 1)
        // )
        //   .map((p) => row[p]?.toString().trim().toUpperCase())
        //   .filter(Boolean);

        // const pumpNumber = row.pumpNumber?.toString().trim().toUpperCase();
        // const controllerNumber = row.controllerNumber
        //   ?.toString()
        //   .trim()
        //   .toUpperCase();
        // const rmuNumber = row.rmuNumber?.toString().trim().toUpperCase();

        // const serialNumbers = [
        //   ...panelNumbers,
        //   pumpNumber,
        //   controllerNumber,
        //   rmuNumber,
        // ].filter(Boolean);

        // // --- Insert missing serials into SerialNumber ---
        // for (let sn of serialNumbers) {
        //   const found = await SerialNumber.findOne({
        //     serialNumber: sn,
        //     state: row.state,
        //   });
        //   if (!found) {
        //     let productType = "panel";
        //     if (sn === pumpNumber) productType = "pump";
        //     if (sn === controllerNumber) productType = "controller";
        //     if (sn === rmuNumber) productType = "rmu";

        //     await SerialNumber.create({
        //       serialNumber: sn,
        //       state: row.state,
        //       productType,
        //       isUsed: false,
        //     });
        //   }
        // }

        // --- Build items list ---
        const systemItems = await SystemItemMap.find({
          systemId: system._id,
        }).populate("systemItemId");
        let itemsList = [];

        for (let si of systemItems) {
          const isPump = si.systemItemId?.itemName
            .toLowerCase()
            .includes("pump");

          if (isPump) {
            // Only include correct pump variant
            if (si.systemItemId?.itemName === row.pumpHead) {
              itemsList.push({
                systemItemId: si.systemItemId._id,
                quantity: si.quantity,
              });

              // Fetch sub-items for this pump
              const components = await ItemComponentMap.find({
                systemId: system._id,
                systemItemId: si.systemItemId._id,
              }).populate("systemItemId");

              for (let comp of components) {
                itemsList.push({
                  systemItemId: comp.subItemId,
                  quantity: comp.quantity,
                });
              }
            }
          } else {
            itemsList.push({
              systemItemId: si.systemItemId._id,
              quantity: si.quantity,
            });
          }
        }

        // --- Check if FarmerActivity already exists ---
        let existingActivity = await FarmerItemsActivity.findOne({
          farmerSaralId: new RegExp(`${row.farmerSaralId}`, "i"),
          state: row.state,
        });

        if (existingActivity) {
          failedRows.push({ ...row, reason: "Data Already Exists" });
          continue;
        }

        // if (existingActivity) {
        //   // Update existing FarmerActivity with new serials
        //   await FarmerItemsActivity.updateOne(
        //     { _id: existingActivity._id },
        //     {
        //       $set: {
        //         panelNumbers,
        //         pumpNumber,
        //         controllerNumber,
        //         rmuNumber,
        //         updatedAt: new Date(),
        //       },
        //     }
        //   );
        // } else {
        // --- Prepare new documents ---
        farmerActivityDocs.push({
          referenceType: "ServicePerson",
          warehouseId: new mongoose.Types.ObjectId("690835908a80011de511b648"),
          farmerSaralId: row.farmerSaralId,
          empId: empData._id,
          systemId: system._id,
          itemsList,
          extraItemsList: [],
          panelNumbers: [],
          extraPanelNumbers: [],
          pumpNumber: "",
          motorNumber: "",
          controllerNumber: "",
          rmuNumber: "",
          state: row.state,
          accepted: false,
          installationDone: false,
          createdBy: new mongoose.Types.ObjectId("679b10c19cffe98b71683bc5"),
          sendingDate: new Date(),
          createdAt: new Date(),
        });

        employeeAssignedDocs.push({
          referenceType: "ServicePerson",
          warehouseId: new mongoose.Types.ObjectId("690835908a80011de511b648"),
          empId: empData._id,
          farmerSaralId: row.farmerSaralId,
          systemId: system._id,
          itemsList,
          extraItemsList: [],
          createdBy: new mongoose.Types.ObjectId("679b10c19cffe98b71683bc5"),
          createdAt: new Date(),
        });
        // }

        // --- Collect serials for update ---
        // serialNumbers.forEach((sn) =>
        //   serialNumbersToUpdate.push({ serialNumber: sn, state: row.state })
        // );
      } catch (innerErr) {
        failedRows.push({
          ...row,
          reason: `Unexpected error: ${innerErr.message}`,
        });
      }
    }

    // --- Insert valid new rows ---
    if (farmerActivityDocs.length > 0) {
      await FarmerItemsActivity.insertMany(farmerActivityDocs);
    }
    if (employeeAssignedDocs.length > 0) {
      await InstallationAssignEmp.insertMany(employeeAssignedDocs);
    }

    // --- Mark serial numbers as used ---
    // if (serialNumbersToUpdate.length > 0) {
    //   const bulkOps = serialNumbersToUpdate.map((sn) => ({
    //     updateOne: {
    //       filter: { serialNumber: sn.serialNumber, state: sn.state },
    //       update: { $set: { isUsed: true } },
    //       upsert: false,
    //     },
    //   }));
    //   await SerialNumber.bulkWrite(bulkOps);
    // }

    // --- If any rows failed, return an Excel ---
    if (failedRows.length > 0) {
      const ws = XLSX.utils.json_to_sheet(failedRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "FailedRows");
      const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=Failed_Rows.xlsx",
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      return res.send(excelBuffer);
    }

    return res.status(200).json({
      success: true,
      message: "Excel data imported successfully",
      recordsProcessed: farmerActivityDocs.length,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ status: false, message: "Server error", error: err.message });
  }
};

module.exports.getInstallerData = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouse;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse Invalid User",
      });
    }

    const warehouseData = await Warehouse.findById(warehouseId);
    let state = null;
    if (warehouseData?.warehouseName === "Bhiwani") {
      state = "Haryana";
    } else if (
      warehouseData?.warehouseName === "Maharashtra Warehouse - Ambad" ||
      warehouseData?.warehouseName === "Maharashtra Warehouse - Badnapur"
    ) {
      state = "Maharashtra";
    }

    const installerData = await ServicePerson.find({
      role: "installer",
      state,
      isActive: true,
    })
      .select("_id name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: installerData || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports.addReplacementDispatch = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      dispatchedList,
      driverName,
      driverContact,
      vehicleNumber,
      movementType,
    } = req.body;

    const activities =
      typeof dispatchedList === "string"
        ? JSON.parse(dispatchedList)
        : dispatchedList;

    if (!Array.isArray(activities) || activities.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No replacement activities provided.",
      });
    }

    if (!driverName || !driverContact || !vehicleNumber || !movementType) {
      return res.status(400).json({
        success: false,
        message: "Driver details & movementType is required.",
      });
    }

    const requiredKeys = ["farmerSaralId", "itemsList"];
    const keyValidation = validateKeys(activities, requiredKeys);
    if (!keyValidation.success) return res.status(400).json(keyValidation);

    // ✅ SINGLE BILL VALIDATION
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Replacement dispatch bill is required",
      });
    }

    const warehousePersonId = req.user._id;
    const warehouseId = req.user.warehouse;
    const warehouseData =
      await Warehouse.findById(warehouseId).session(session);
    if (!warehouseData) throw new Error("Warehouse not found");

    const stateMap = {
      Bhiwani: "Haryana",
      "Maharashtra Warehouse - Ambad": "Maharashtra",
      "Maharashtra Warehouse - Badnapur": "Maharashtra",
      "Korba Chhattisgarh": "Chhattisgarh",
    };
    const state = stateMap[warehouseData.warehouseName] || "";

    const dispatchDetails = new ReplacementDispatchDetails({
      driverName,
      driverContact,
      vehicleNumber,
      movementType,
      dispatchedBy: warehousePersonId,
      warehouseId,
      dispatchedReplacementActivities: [],
    });
    await dispatchDetails.save({ session });

    // 2️⃣ Loop through replacement activities
    for (const activity of activities) {
      // 3️⃣ Stock update
      for (const item of activity.itemsList) {
        const stockDoc = await InstallationInventory.findOne({
          warehouseId,
          systemItemId: item.systemItemId,
        }).session(session);

        if (!stockDoc) {
          throw new Error("Item not found in inventory");
        }

        if (movementType === "Replacement") {
          if (stockDoc.quantity < item.quantity) {
            throw new Error("Insufficient stock for replacement item");
          }

          stockDoc.quantity -= item.quantity;
        } else if (movementType === "Defective") {
          stockDoc.defective = (stockDoc.defective || 0) + item.quantity;
        }

        stockDoc.updatedAt = new Date();
        stockDoc.updatedBy = warehousePersonId;

        await stockDoc.save({ session });
      }

      // 4️⃣ Create replacement activity
      const replacementActivity = new FarmerReplacementItemsActivity({
        warehouseId,
        farmerSaralId: activity.farmerSaralId,
        movementType: movementType,
        itemsList: activity.itemsList,
        state: state,
        sendingDate: movementType === "Replacement" ? new Date() : null,
        receivingDate: movementType === "Defective" ? new Date() : null,
        createdBy: warehousePersonId,
      });

      await replacementActivity.save({ session });

      dispatchDetails.dispatchedReplacementActivities.push(
        replacementActivity._id,
      );
    }

    // 5️⃣ SAVE SINGLE BILL PHOTO (ONLY ONCE)
    const billPhotoPath = `/uploads/replacementDispatch/dispatchBill/${req.file.filename}`;

    const billPhoto = new ReplacementDispatchBillPhoto({
      replacementDispatchId: dispatchDetails._id,
      billPhoto: billPhotoPath,
    });

    await billPhoto.save({ session });

    // 6️⃣ Final save + commit
    await dispatchDetails.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `${movementType === "Replacement" ? "Replacement Items Dispatched Successfully" : "Defective Items Received Successfully"}`,
      data: dispatchDetails,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.addReplacementDispatch2 = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      dispatchedList,
      driverName,
      driverContact,
      vehicleNumber,
      movementType,
    } = req.body;

    const activities =
      typeof dispatchedList === "string"
        ? JSON.parse(dispatchedList)
        : dispatchedList;

    if (!Array.isArray(activities) || activities.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No replacement activities provided.",
      });
    }

    if (!driverName || !driverContact || !vehicleNumber || !movementType) {
      return res.status(400).json({
        success: false,
        message: "Driver details & movementType is required.",
      });
    }

    if (!["Replacement", "Defective", "OK_RETURNED"].includes(movementType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid movementType",
      });
    }

    const requiredKeys = ["farmerSaralId", "itemsList"];
    const keyValidation = validateKeys(activities, requiredKeys);
    if (!keyValidation.success) return res.status(400).json(keyValidation);

    // ✅ SINGLE BILL VALIDATION
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Replacement dispatch bill is required",
      });
    }

    const warehousePersonId = req.user._id;
    const warehouseId = req.user.warehouse;
    const warehouseData =
      await Warehouse.findById(warehouseId).session(session);
    if (!warehouseData) throw new Error("Warehouse not found");

    const stateMap = {
      Bhiwani: "Haryana",
      "Maharashtra Warehouse - Ambad": "Maharashtra",
      "Maharashtra Warehouse - Badnapur": "Maharashtra",
      "Korba Chhattisgarh": "Chhattisgarh",
    };
    const state = stateMap[warehouseData.warehouseName] || "";

    const dispatchDetails = new ReplacementDispatchDetails({
      driverName,
      driverContact,
      vehicleNumber,
      movementType,
      dispatchedBy: warehousePersonId,
      warehouseId,
      dispatchedReplacementActivities: [],
    });
    await dispatchDetails.save({ session });

    // 2️⃣ Loop through replacement activities
    for (const activity of activities) {
      // 3️⃣ Stock update
      for (const item of activity.itemsList) {
        const stockDoc = await InstallationInventory.findOne({
          warehouseId,
          systemItemId: item.systemItemId,
        }).session(session);

        if (!stockDoc) {
          throw new Error("Item not found in inventory");
        }

        if (movementType === "Replacement") {
          if (stockDoc.quantity < item.quantity) {
            throw new Error("Insufficient stock for replacement item");
          }

          stockDoc.quantity -= item.quantity;
        } else if (movementType === "Defective") {
          stockDoc.defective = (stockDoc.defective || 0) + item.quantity;
        } else if (movementType === "OK_RETURNED") {
          stockDoc.quantity = (stockDoc.quantity || 0) + item.quantity;
        }

        stockDoc.updatedAt = new Date();
        stockDoc.updatedBy = warehousePersonId;

        await stockDoc.save({ session });
      }

      // 4️⃣ Create replacement activity
      const replacementActivity = new FarmerReplacementItemsActivity({
        warehouseId,
        farmerSaralId: activity.farmerSaralId,
        movementType: movementType,
        itemsList: activity.itemsList,
        state: state,
        sendingDate: movementType === "Replacement" ? new Date() : null,
        receivingDate:
          movementType === "Defective" || movementType === "OK_RETURNED"
            ? new Date()
            : null,
        createdBy: warehousePersonId,
      });

      await replacementActivity.save({ session });

      dispatchDetails.dispatchedReplacementActivities.push(
        replacementActivity._id,
      );
    }

    // 5️⃣ SAVE SINGLE BILL PHOTO (ONLY ONCE)
    const billPhotoPath = `/uploads/replacementDispatch/dispatchBill/${req.file.filename}`;

    const billPhoto = new ReplacementDispatchBillPhoto({
      replacementDispatchId: dispatchDetails._id,
      billPhoto: billPhotoPath,
    });

    await billPhoto.save({ session });

    // 6️⃣ Final save + commit
    await dispatchDetails.save({ session });
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: `${movementType === "Replacement" ? "Replacement Items Dispatched Successfully" : "Defective Items Received Successfully"}`,
      data: dispatchDetails,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    if (req.file) {
      fs.unlink(req.file.path, () => {});
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getAllReplacementDispatches = async (req, res) => {
  try {
    const dispatches = await ReplacementDispatchDetails.find()
      .sort({ createdAt: -1 })
      .populate("warehouseId", "warehouseName")
      .populate("dispatchedBy", "name")
      .populate({
        path: "dispatchedReplacementActivities",
        select:
          "farmerSaralId movementType itemsList sendingDate receivingDate",
        populate: {
          path: "itemsList.systemItemId",
          select: "itemName",
        },
      })
      .lean();

    const dispatchIds = dispatches.map((d) => d._id);

    const billPhotos = await ReplacementDispatchBillPhoto.find({
      replacementDispatchId: { $in: dispatchIds },
    }).lean();

    const billMap = {};
    billPhotos.forEach((photo) => {
      billMap[photo.replacementDispatchId.toString()] = photo.billPhoto;
    });

    // 🔥 FORMAT DATA HERE
    const formattedData = dispatches.map((dispatch) => ({
      dispatchId: dispatch._id,
      driverName: dispatch.driverName,
      driverContact: dispatch.driverContact,
      vehicleNumber: dispatch.vehicleNumber,
      movementType: dispatch.movementType,
      warehouse: dispatch.warehouseId?.warehouseName || null,
      dispatchedBy: dispatch.dispatchedBy?.name || null,
      billPhoto: billMap[dispatch._id.toString()] || null,
      createdAt: dispatch.createdAt,

      replacementActivities: dispatch.dispatchedReplacementActivities.map(
        (activity) => ({
          farmerSaralId: activity.farmerSaralId,
          movementType: activity.movementType,
          sendingDate: activity.sendingDate,
          receivingDate: activity.receivingDate,

          items: activity.itemsList.map((item) => ({
            itemName: item.systemItemId?.itemName || null,
            quantity: item.quantity,
          })),
        }),
      ),
    }));

    return res.status(200).json({
      success: true,
      count: formattedData.length,
      data: formattedData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports.createMaterialDispatchLog = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { movementType, itemsList, partyName, address, purpose, remarks } =
      req.body;

    const items =
      typeof itemsList === "string" ? JSON.parse(itemsList) : itemsList;

    if (!movementType || !["IN", "OUT"].includes(movementType)) {
      return res.status(400).json({
        success: false,
        message: "Valid movementType (IN / OUT) is required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items list is required",
      });
    }

    for (const item of items) {
      if (!item.systemItemId || !item.quantity) {
        return res.status(400).json({
          success: false,
          message: "systemItemId and quantity are required in itemsList",
        });
      }
    }

    if (!partyName || !address || !remarks) {
      return res.status(400).json({
        success: false,
        message: "partyName, address, remarks are required.",
      });
    }

    const warehousePersonId = req.user._id;
    const warehouseId = req.user.warehouse;

    const warehouseData =
      await Warehouse.findById(warehouseId).session(session);
    if (!warehouseData) throw new Error("Warehouse not found");

    const stateMap = {
      Bhiwani: "Haryana",
      "Maharashtra Warehouse - Ambad": "Maharashtra",
      "Maharashtra Warehouse - Badnapur": "Maharashtra",
      "Korba Chhattisgarh": "Chhattisgarh",
    };

    const state = stateMap[warehouseData.warehouseName] || "";

    // 🔁 STOCK UPDATE
    for (const item of items) {
      const stockDoc = await InstallationInventory.findOne({
        warehouseId,
        systemItemId: item.systemItemId,
      }).session(session);

      if (!stockDoc) {
        throw new Error("Item not found in inventory");
      }

      if (movementType === "OUT") {
        if (stockDoc.quantity < item.quantity) {
          throw new Error("Insufficient stock");
        }
        stockDoc.quantity -= item.quantity;
      } else {
        stockDoc.quantity += item.quantity;
      }

      stockDoc.updatedAt = new Date();
      stockDoc.updatedBy = warehousePersonId;
      await stockDoc.save({ session });
    }

    const dispatchLog = await MaterialDispatchLog.create(
      [
        {
          warehouseId,
          movementType,
          itemsList: items,
          state,
          partyName,
          address,
          purpose,
          remarks,
          sendingDate: movementType === "OUT" ? new Date() : null,
          receivingDate: movementType === "IN" ? new Date() : null,
          createdBy: warehousePersonId,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message:
        movementType === "OUT"
          ? "Material dispatched successfully"
          : "Material received successfully",
      data: dispatchLog[0],
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getMaterialDispatchLogs = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouse;

    const filter = {};
    if (warehouseId) filter.warehouseId = warehouseId;

    const logs = await MaterialDispatchLog.find(filter)
      .populate("warehouseId", "warehouseName")
      .populate("itemsList.systemItemId", "itemName")
      .sort({ createdAt: -1 })
      .lean();

    const cleanData = logs.map((log) => ({
      id: log._id,
      warehouseName: log.warehouseId?.warehouseName || "",
      movementType: log.movementType,
      purpose: log.purpose || null,
      partyName: log.partyName,
      address: log.address,
      remarks: log.remarks || "",
      date: log.movementType === "OUT" ? log.sendingDate : log.receivingDate,
      items: log.itemsList.map((item) => ({
        itemName: item.systemItemId?.itemName || "",
        quantity: item.quantity,
      })),
    }));

    return res.status(200).json({
      success: true,
      count: cleanData.length,
      data: cleanData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.addDispatchSerialNumbers = async (req, res) => {
  try {
    const {
      vehicleNumber,
      farmerSaralIds = [],
      panels = [],
      motors = [],
      pumps = [],
      controllers = [],
      rmus = [],
    } = req.body;

    const createdBy = req.user?.id; // assuming auth middleware

    if (!vehicleNumber) {
      return res.status(400).json({
        success: false,
        message: "vehicleNumber is required",
      });
    }

    if (!createdBy) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const duplicate = await DispatchSerialNumbers.findOne({
      $or: [
        { farmerSaralIds: { $in: farmerSaralIds } },
        { panels: { $in: panels } },
        { motors: { $in: motors } },
        { pumps: { $in: pumps } },
        { controllers: { $in: controllers } },
        { rmus: { $in: rmus } },
      ],
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "One or more serial numbers already exist in another dispatch",
      });
    }

    const dispatch = await DispatchSerialNumbers.create({
      vehicleNumber,
      farmerSaralIds,
      panels,
      motors,
      pumps,
      controllers,
      rmus,
      createdBy,
    });

    return res.status(201).json({
      success: true,
      message: "Dispatch serial numbers added successfully",
      data: dispatch,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getDispatchSerialNumbers = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const data = await DispatchSerialNumbers.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "name")
      .select("-__v -updatedAt")
      .lean();

    const total = await DispatchSerialNumbers.countDocuments();

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports.getPumpDataBySystem = async (req, res) => {
  const { systemId } = req.query;

  try {
    const items = await ItemComponentMap.find({ systemId }).populate({
      path: "systemItemId",
      select: "_id itemName",
    });

    if (!items || items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No system items found for the system",
      });
    }

    // Filter unique systemItemId
    const uniqueItemsMap = new Map();
    items.forEach((item) => {
      const id = item.systemItemId?._id?.toString();
      if (id && !uniqueItemsMap.has(id)) {
        uniqueItemsMap.set(id, {
          _id: item.systemItemId._id,
          itemName: item.systemItemId.itemName,
        });
      }
    });

    const uniqueItems = Array.from(uniqueItemsMap.values());

    // ✅ Custom sort for pumps (like "PUMP 3HP DC 30M")
    const sortedItems = uniqueItems.sort((a, b) => {
      const extractPumpInfo = (name) => {
        const match = name.match(/PUMP\s*(\d+)HP.*?(\d+)M/i);
        return match ? { hp: +match[1], head: +match[2] } : { hp: 0, head: 0 };
      };

      const aInfo = extractPumpInfo(a.itemName);
      const bInfo = extractPumpInfo(b.itemName);

      if (aInfo.hp !== bInfo.hp) return aInfo.hp - bInfo.hp; // Sort by HP first
      return aInfo.head - bInfo.head; // Then by Head (M)
    });

    res.status(200).json({
      success: true,
      message: "Unique system items fetched and sorted successfully",
      data: sortedItems,
    });
  } catch (error) {
    console.error("Error fetching items by systemId:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// -------------

module.exports.getAllDispatchHistory = async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    let { pageNo = 1, limit = 50 } = req.query;

    pageNo = Number(pageNo || 50);
    limit = Number(limit || 50);

    const skip = (pageNo - 1) * limit;

    const totalRecord = await DispatchDetails.countDocuments();
    const totalPages = Math.ceil(totalRecord / limit);

    const history = await DispatchDetails.aggregate([
      {
        $sort: {
          createdAt: -1,
        },
      },

      {
        $skip: skip,
      },

      {
        $limit: limit,
      },

      // ==========================================
      // GET WAREHOUSE DETAILS
      // DispatchDetails.warehouseId
      //        ↓
      // warehouses._id
      // ==========================================

      {
        $lookup: {
          from: "inWarehouses",
          localField: "warehouseId",
          foreignField: "_id",
          as: "warehouseInfo",
        },
      },

      // ==========================================
      // GET WAREHOUSE NAME
      // ==========================================

      {
        $addFields: {
          warehouseName: {
            $arrayElemAt: ["$warehouseInfo.warehouseName", 0],
          },
        },
      },

      // ==========================================
      // FARMER ACTIVITIES
      // ==========================================

      {
        $lookup: {
          from: "inFarmerItemsActivities",
          localField: "dispatchedSystems",
          foreignField: "_id",
          as: "farmerActivities",
        },
      },

      // ==========================================
      // SYSTEM INFORMATION
      // ==========================================

      {
        $lookup: {
          from: "inSystems",
          localField: "farmerActivities.systemId",
          foreignField: "_id",
          as: "systemsInfo",
        },
      },

      // ==========================================
      // BILL PHOTOS
      // ==========================================

      {
        $lookup: {
          from: "inDispatchBillPhotos",
          localField: "farmerActivities._id",
          foreignField: "farmerActivityId",
          as: "billPhotos",
        },
      },

      // ==========================================
      // SYSTEM ITEMS
      // ==========================================

      {
        $lookup: {
          from: "inSystemItems",
          localField: "farmerActivities.itemsList.systemItemId",
          foreignField: "_id",
          as: "systemItems",
        },
      },

      // ==========================================
      // FARMER DATA
      // ==========================================

      {
        $addFields: {
          farmers: {
            $map: {
              input: "$farmerActivities",
              as: "fa",

              in: {
                // ----------------------------------
                // FARMER SARAL ID
                // ----------------------------------

                farmerSaralId: "$$fa.farmerSaralId",

                // ----------------------------------
                // SYSTEM NAME
                // ----------------------------------

                systemName: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$systemsInfo",
                          as: "s",

                          cond: {
                            $eq: ["$$s._id", "$$fa.systemId"],
                          },
                        },
                      },

                      as: "matched",

                      in: "$$matched.systemName",
                    },
                  },
                },

                // ----------------------------------
                // PUMP DATA
                // ----------------------------------

                pumpData: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: {
                            $map: {
                              input: "$$fa.itemsList",
                              as: "it",

                              in: {
                                $mergeObjects: [
                                  "$$it",

                                  {
                                    systemItemId: {
                                      $first: {
                                        $filter: {
                                          input: "$systemItems",
                                          as: "si",

                                          cond: {
                                            $eq: [
                                              "$$si._id",
                                              "$$it.systemItemId",
                                            ],
                                          },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          },

                          as: "item",

                          cond: {
                            $regexMatch: {
                              input: "$$item.systemItemId.itemName",

                              regex: /pump/i,
                            },
                          },
                        },
                      },

                      as: "matched",

                      in: {
                        name: "$$matched.systemItemId.itemName",
                      },
                    },
                  },
                },

                // ----------------------------------
                // CONTROLLER DATA
                // ----------------------------------

                controllerData: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: {
                            $map: {
                              input: "$$fa.itemsList",
                              as: "it",

                              in: {
                                $mergeObjects: [
                                  "$$it",

                                  {
                                    systemItemId: {
                                      $first: {
                                        $filter: {
                                          input: "$systemItems",
                                          as: "si",

                                          cond: {
                                            $eq: [
                                              "$$si._id",
                                              "$$it.systemItemId",
                                            ],
                                          },
                                        },
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                          },

                          as: "item",

                          cond: {
                            $regexMatch: {
                              input: "$$item.systemItemId.itemName",

                              regex: /controller/i,
                            },
                          },
                        },
                      },

                      as: "matched",

                      in: {
                        name: "$$matched.systemItemId.itemName",
                      },
                    },
                  },
                },

                // ----------------------------------
                // BILL PHOTO
                // ----------------------------------

                billPhoto: {
                  $first: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$billPhotos",

                          as: "bp",

                          cond: {
                            $eq: ["$$bp.farmerActivityId", "$$fa._id"],
                          },
                        },
                      },

                      as: "matched",

                      in: {
                        $concat: [baseUrl, "$$matched.billPhoto"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ==========================================
      // FINAL RESPONSE
      // ==========================================

      {
        $project: {
          _id: 0,

          warehouseName: 1,

          dispatchDate: "$createdAt",

          driverName: 1,

          driverContact: 1,

          vehicleNumber: 1,

          farmers: 1,
        },
      },
    ]);

    // ==========================================
    // NO DATA
    // ==========================================

    if (!history.length) {
      return res.status(404).json({
        success: false,
        message: "No dispatch history found",
      });
    }

    // ==========================================
    // SUCCESS
    // ==========================================

    return res.status(200).json({
      success: true,
      message: "Dispatch history fetched successfully",
      data: history,
      totalRecord,
      totalPages,
    });
  } catch (er) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: er.message,
    });
  }
};
