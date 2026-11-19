const prisma = require("../../config/prismaClient");
const WarehouseItems = require("../../models/serviceInventoryModels/warehouseItemsSchema");
const axios = require("axios");
const moment = require("moment");
const mongoose = require("mongoose");
const ExcelJs = require("exceljs");
const generatePO = require("../../util/generatePO");
const InstallationInventory = require("../../models/systemInventoryModels/installationInventorySchema");
const companyShortName = require("../../util/companyShortName");

const getDefectiveItemsForWarehouse = async (req, res) => {
  try {
    const warehouseName = "Bhiwani"; // Example warehouse name, can be dynamic if needed

    const result = await WarehouseItems.aggregate([
      {
        $lookup: {
          from: "inWarehouses", // Name of the Warehouse collection in MongoDB
          localField: "warehouse",
          foreignField: "_id",
          as: "warehouseDetails",
        },
      },
      { $unwind: "$warehouseDetails" }, // Unwind warehouse details array
      { $match: { "warehouseDetails.warehouseName": warehouseName } }, // Match specific warehouse name
      { $unwind: "$items" }, // Unwind items array to process individual items
      {
        $group: {
          _id: {
            $cond: [
              { $regexMatch: { input: "$items.itemName", regex: /motor/i } },
              "motor",
              {
                $cond: [
                  { $regexMatch: { input: "$items.itemName", regex: /pump/i } },
                  "pump",
                  {
                    $cond: [
                      {
                        $regexMatch: {
                          input: "$items.itemName",
                          regex: /controller/i,
                        },
                      },
                      "controller",
                      "others",
                    ],
                  },
                ],
              },
            ],
          },
          totalDefective: { $sum: "$items.defective" }, // Sum defective items
        },
      },
      {
        $group: {
          _id: null,
          totalsByGroup: {
            $push: {
              item: {
                $concat: [
                  { $toUpper: { $substr: ["$_id", 0, 1] } }, // Capitalize first letter
                  { $toLower: { $substr: ["$_id", 1, { $strLenCP: "$_id" }] } }, // Rest in lowercase
                ],
              },
              defectiveCount: "$totalDefective",
            },
          },
          overallTotal: { $sum: "$totalDefective" }, // Calculate overall defective count
        },
      },
      {
        $project: {
          _id: 0,
          totalsByGroup: 1,
          overallTotal: 1,
        },
      },
    ]);

    // Handle case when no matching warehouse is found
    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No defective items found for warehouse: ${warehouseName}`,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Defective items for warehouse: ${warehouseName}`,
      data: result[0] || [], // Return the aggregated data
    });
  } catch (error) {
    console.error("Error fetching defective items:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch defective items",
      error: error.message,
    });
  }
};

// const getDefectiveItemsListByWarehouse = async (req, res) => {
//   try {
//     const { itemName } = req.query; // Get warehouse and item names from query
//     const warehouseName = "Bhiwani";
//     if (!warehouseName || !itemName) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide both warehouseName and itemName to filter by.",
//       });
//     }

//     const items = await WarehouseItems.aggregate([
//       // Lookup to get warehouse details based on warehouse ID
//       {
//         $lookup: {
//           from: "inWarehouses", // Collection name for warehouses in MongoDB
//           localField: "warehouse",
//           foreignField: "_id",
//           as: "warehouseDetails",
//         },
//       },
//       { $unwind: "$warehouseDetails" }, // Unwind warehouse details to access fields
//       {
//         $match: {
//           "warehouseDetails.warehouseName": warehouseName, // Filter by specific warehouse name
//         },
//       },
//       { $unwind: "$items" }, // Unwind items array to filter individual items
//       {
//         $match: {
//           "items.itemName": { $regex: itemName, $options: "i" }, // Case-insensitive match for item name
//         },
//       },
//       {
//         $project: {
//           itemName: "$items.itemName",
//           // quantity: "$items.quantity",
//           defective: "$items.defective",
//           // repaired: "$items.repaired",
//           // rejected: "$items.rejected",
//         },
//       },
//     ]);

//     if (items.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: `No items found matching '${itemName}' in warehouse '${warehouseName}'.`,
//       });
//     }

//     return res.status(201).json({
//       success: true,
//       message: `Items matching '${itemName}' in warehouse '${warehouseName}' found.`,
//       data: items || [],
//     });
//   } catch (error) {
//     console.error("Error fetching items:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch items.",
//       error: error.message,
//     });
//   }
// };

// const getDefectiveItemsListByWarehouse = async (req, res) => {
//   try {
//     const { itemName } = req.query;
//     const warehouseName = "Bhiwani";

//     if (!warehouseName || !itemName) {
//       return res.status(400).json({
//         success: false,
//         message: "Please provide both warehouseName and itemName to filter by.",
//       });
//     }

//     // Split itemName into individual words for flexible matching
//     const searchWords = itemName.split(" ").filter(Boolean);

//     // Create an array of regex conditions (all words must appear)
//     const regexConditions = searchWords.map((word) => ({
//       "items.itemName": { $regex: word, $options: "i" },
//     }));

//     const items = await WarehouseItems.aggregate([
//       {
//         $lookup: {
//           from: "inWarehouses",
//           localField: "warehouse",
//           foreignField: "_id",
//           as: "warehouseDetails",
//         },
//       },
//       { $unwind: "$warehouseDetails" },
//       {
//         $match: {
//           "warehouseDetails.warehouseName": warehouseName,
//         },
//       },
//       { $unwind: "$items" },
//       {
//         $match: {
//           $and: regexConditions, // ensure all words are present
//         },
//       },
//       {
//         $project: {
//           itemName: "$items.itemName",
//           defective: "$items.defective",
//         },
//       },
//     ]);

//     if (items.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: `No items found matching '${itemName}' in warehouse '${warehouseName}'.`,
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: `Items matching '${itemName}' in warehouse '${warehouseName}' found.`,
//       data: items,
//     });
//   } catch (error) {
//     console.error("Error fetching items:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch items.",
//       error: error.message,
//     });
//   }
// };

const addWarehouse = async (req, res) => {
  try {
    const { name, state } = req.body;

    if (!name || !state) {
      return res.status(400).json({
        success: false,
        message: "Name and state are required",
      });
    }

    const warehouseName = name.toLowerCase().trim();
    const warehouseState = state.toLowerCase().trim();

    // Case-insensitive check for existing warehouse
    const existingWarehouse = await prisma.$queryRaw`
            SELECT * FROM Warehouse
            WHERE LOWER(name) = LOWER(${warehouseName}) 
            AND LOWER(state) = LOWER(${warehouseState})
            LIMIT 1;
        `;

    if (existingWarehouse.length > 0) {
      // Check if an entry exists
      return res.status(400).json({
        success: false,
        message: "Warehouse with this name and state already exists",
      });
    }

    // Create new warehouse
    const newWarehouse = await prisma.warehouse.create({
      data: {
        name: name,
        state: state,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Warehouse added successfully",
      warehouse: newWarehouse,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showEmployees = async (req, res) => {
  try {
    const allEmployees = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        contact: true,
        roleId: true,
        role: {
          select: {
            name: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Data Fetched Successfully",
      data: allEmployees || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const deactivateEmployee = async (req, res) => {
  try {
    const { empId, status } = req.query;
    console.log("status :-", status);
    if (!empId || status === undefined) {
      return res.status(400).json({
        success: false,
        message: "EmpId and status are required",
      });
    }

    const existingEmployee = await prisma.user.findUnique({
      where: {
        id: empId,
      },
    });

    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        message: "Employee with empId doesn't exists",
      });
    }

    if (existingEmployee.isActive === status) {
      return res.status(400).json({
        success: false,
        message: status ? "Employee already activated" : "Employee is already deactivated",
      });
    }

    const deactivateEmp = await prisma.user.update({
      where: {
        id: empId,
      },
      data: {
        isActive: status,
      },
    });

    return res.status(201).json({
      success: true,
      message: status ? "Employee account activated successfully" : "Employee account deactivated successfully",
      data: deactivateEmp,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const activateEmployee = async (req, res) => {
  try {
    const { empId } = req.query;
    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "EmpId is required",
      });
    }

    const existingEmployee = await prisma.user.findUnique({
      where: {
        id: empId,
      },
    });

    if (!existingEmployee) {
      return res.status(404).json({
        success: false,
        message: "Employee with empId doesn't exists",
      });
    }

    if (existingEmployee.isActive) {
      return res.status(400).json({
        success: false,
        message: "Employee is already active",
      });
    }

    const activateEmp = await prisma.user.update({
      where: {
        id: empId,
      },
      data: {
        isActive: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Employee account activated successfully",
      data: activateEmp,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addItem = async (req, res) => {
  try {
    let { name } = req.body;

    // Validate input
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Invalid item name",
      });
    }

    name = name.trim(); // Trim only once

    // Check if item already exists
    const existingItem = await prisma.item.findUnique({
      where: { name },
    });

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: "Item Already Exists",
      });
    }

    // Create new item
    const newItem = await prisma.item.create({
      data: { name },
    });

    return res.status(201).json({
      success: true,
      message: "Item Added Successfully",
      data: newItem,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showItems = async (req, res) => {
  try {
    const allItems = await prisma.item.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Items fetched successfully",
      data: allItems,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const deleteItem = async (req, res) => {
  try {
    const { itemId } = req.query;
    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ItemId is required",
      });
    }

    const deletedItem = await prisma.item.delete({
      where: { id: itemId }, // Ensure the itemId is cast to a number if it's an integer in your DB
    });

    return res.status(201).json({
      success: true,
      message: "Item deleted successfully",
      data: deletedItem,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addRawMaterial = async (req, res) => {
  try {
    const { rawMaterialName, unit } = req.body;
    if (!rawMaterialName || !unit) {
      return res.status(400).json({
        success: false,
        message: "rawMaterialName is required",
      });
    }

    const name = rawMaterialName.trim(); // Trim only once

    // Check if item already exists
    const existingItem = await prisma.rawMaterial.findUnique({
      where: { name },
    });

    if (existingItem) {
      return res.status(400).json({
        success: false,
        message: "RawMaterial Already Exists",
      });
    }

    const addRawMaterial = await prisma.rawMaterial.create({
      data: {
        name: rawMaterialName,
        stock: 0,
        unit: unit,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Raw-Material Added Successfully",
      data: addRawMaterial,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// const showRawMaterials = async (req, res) => {
//     try {
//         const allRawMaterials = await prisma.rawMaterial.findMany({
//             select: {
//                 id: true,
//                 name: true,
//                 stock: true
//             }
//         });

//         return res.status(201).json({
//             success: true,
//             message: "Raw-Materials fetched successfully",
//             data: allRawMaterials
//         });

//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             message: "Internal Server Error",
//             error: error.message
//         })
//     }
// }

// const showRawMaterials = async (req, res) => {
//     try {
//         // Get all raw materials
//         const allRawMaterials = await prisma.rawMaterial.findMany({
//             select: {
//                 id: true,
//                 name: true,
//                 stock: true
//             }
//         });

//         // For each raw material, find the max quantity used in any item
//         const enrichedRawMaterials = await Promise.all(
//             allRawMaterials.map(async (rm) => {
//                 const maxUsed = await prisma.itemRawMaterial.aggregate({
//                     where: { rawMaterialId: rm.id },
//                     _max: {
//                         quantity: true
//                     }
//                 });

//                 const maxQuantity = maxUsed._max.quantity || 0;
//                 const isLow = maxQuantity === 0 ? false : rm.stock < maxQuantity * 50;

//                 return {
//                     ...rm,
//                     stockIsLow: isLow
//                 };
//             })
//         );

//         enrichedRawMaterials.sort((a, b) => {
//             if (a.stockIsLow === b.stockIsLow) return 0;
//             return a.stockIsLow ? -1 : 1;
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Raw-Materials fetched successfully",
//             data: enrichedRawMaterials
//         });

//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             message: "Internal Server Error",
//             error: error.message
//         });
//     }
// };

// const showRawMaterials = async (req, res) => {
//     try {
//         const allRawMaterials = await prisma.rawMaterial.findMany({
//             select: {
//                 id: true,
//                 name: true,
//                 stock: true
//             }
//         });

//         const enrichedRawMaterials = await Promise.all(
//             allRawMaterials.map(async (rm) => {
//                 const maxUsed = await prisma.itemRawMaterial.aggregate({
//                     where: { rawMaterialId: rm.id },
//                     _max: { quantity: true }
//                 });

//                 const maxQuantity = maxUsed._max.quantity || 0;
//                 const isLow = maxQuantity === 0 ? false : rm.stock < maxQuantity * 50;

//                 return {
//                     ...rm,
//                     stockIsLow: isLow
//                 };
//             })
//         );

//         enrichedRawMaterials.sort((a, b) => {
//             if (a.stockIsLow && b.stockIsLow) {
//                 return a.stock - b.stock;
//             }
//             if (a.stockIsLow) return -1;
//             if (b.stockIsLow) return 1;
//             return 0;
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Raw-Materials fetched successfully",
//             data: enrichedRawMaterials
//         });

//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             message: "Internal Server Error",
//             error: error.message
//         });
//     }
// };

const showRawMaterials = async (req, res) => {
  try {
    const { itemId } = req.query;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "ItemId is required",
      });
    }

    // Step 1: Get raw materials attached to this itemId
    const rawMaterialsForItem = await prisma.itemRawMaterial.findMany({
      where: { itemId },
      select: {
        rawMaterial: {
          select: {
            id: true,
            name: true,
            stock: true,
            unit: true,
          },
        },
        quantity: true,
      },
    });

    // Step 2: Enrich each raw material with stock health
    const enrichedRawMaterials = await Promise.all(
      rawMaterialsForItem.map(async (entry) => {
        const { rawMaterial, quantity } = entry;

        const maxUsed = await prisma.itemRawMaterial.aggregate({
          where: { rawMaterialId: rawMaterial.id },
          _max: { quantity: true },
        });

        const maxQuantity = maxUsed._max.quantity || 0;
        const stockIsLow =
          maxQuantity === 0 ? false : rawMaterial.stock < maxQuantity * 50;

        return {
          id: rawMaterial.id,
          name: rawMaterial.name,
          stock: rawMaterial.stock,
          unit: rawMaterial.unit,
          quantityUsedInThisItem: quantity,
          stockIsLow,
        };
      }),
    );

    // Step 3: Sort: low stock first, then all in ascending order of stock
    enrichedRawMaterials.sort((a, b) => {
      if (a.stockIsLow !== b.stockIsLow) {
        return a.stockIsLow ? -1 : 1;
      }
      return a.stock - b.stock;
    });

    // Step 4: Send response
    return res.status(200).json({
      success: true,
      message: "Raw materials fetched successfully for this item",
      data: enrichedRawMaterials,
    });
  } catch (error) {
    console.error("Error in showRawMaterials:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateRawMaterialStock = async (req, res) => {
  const { rawMaterialId, userId, warehouseId, quantity, type } = req.body;

  try {
    if (!rawMaterialId || !quantity || !type) {
      return res.status(400).json({
        success: false,
        message: "rawMaterialId, quantity, and type are required.",
      });
    }

    const rawMaterial = await prisma.rawMaterial.findUnique({
      where: { id: rawMaterialId },
    });

    if (!rawMaterial) {
      return res.status(404).json({
        success: false,
        message: "Raw Material not found",
      });
    }

    // Calculate updated stock based on type ("IN" or "OUT")
    let updatedStock;
    if (type === "IN") {
      updatedStock = (rawMaterial.stock || 0) + quantity;
    } else if (type === "OUT") {
      if ((rawMaterial.stock || 0) < quantity) {
        return res.status(400).json({
          success: false,
          message: "Insufficient stock for this operation.",
        });
      }
      updatedStock = rawMaterial.stock - quantity;
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid type. It should be 'IN' or 'OUT'.",
      });
    }

    // Update the raw material's stock
    await prisma.rawMaterial.update({
      where: { id: rawMaterialId },
      data: { stock: updatedStock },
    });

    if (userId) {
      const userExists = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!userExists) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
    }

    // Create stock movement with nested relation syntax
    const stockMovement = await prisma.stockMovement.create({
      data: {
        rawMaterial: {
          connect: { id: rawMaterialId }, // Connects to existing rawMaterial
        },
        user: userId
          ? {
              connect: { id: userId }, // Connects to existing user if provided
            }
          : undefined,
        warehouse: warehouseId
          ? {
              connect: { id: warehouseId }, // Connects to existing warehouse if provided
            }
          : undefined,
        quantity,
        unit: rawMaterial.unit,
        type,
      },
    });

    // Return success response
    return res.status(201).json({
      success: true,
      message: "Stock updated successfully and stock movement entry created.",
      updatedStock,
      stockMovement,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const deleteAllRawMaterials = async (req, res) => {
  try {
    await prisma.rawMaterial.deleteMany(); // Deletes all rows in the RawMaterial table

    return res.status(201).json({
      success: true,
      message: "All raw materials have been deleted successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const attachItemToRawMaterial = async (req, res) => {
  try {
    const { itemId, rawMaterialId, quantity } = req.body;

    // Validation to ensure required fields are provided
    if (!itemId || !rawMaterialId || quantity == null) {
      return res.status(400).json({
        success: false,
        message: "itemId, rawMaterialId, and quantity are required.",
      });
    }

    // Check if the item and rawMaterial exist
    const itemExists = await prisma.item.findUnique({ where: { id: itemId } });
    const rawMaterialExists = await prisma.rawMaterial.findUnique({
      where: { id: rawMaterialId },
    });

    if (!itemExists || !rawMaterialExists) {
      return res.status(404).json({
        success: false,
        message: "Item or Raw Material not found.",
      });
    }

    // Create or update the ItemRawMaterial relationship
    const itemRawMaterial = await prisma.itemRawMaterial.upsert({
      where: { itemId_rawMaterialId: { itemId, rawMaterialId } },
      update: { quantity }, // Update quantity if the relation already exists
      create: { itemId, rawMaterialId, quantity }, // Create new relation if it doesn't exist
    });

    return res.status(201).json({
      success: true,
      message: "Item successfully attached to Raw Material.",
      data: itemRawMaterial,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getItemsByName = async (req, res) => {
  try {
    const { searchQuery } = req.query;

    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: "Search query is required.",
      });
    }

    const items = await prisma.item.findMany({
      where: {
        name: {
          contains: searchQuery, // Partial match
          //mode: "insensitive",   // Case-insensitive
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!items.length) {
      return res.status(404).json({
        success: false,
        message: "No items found matching the search query.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Items fetched successfully.",
      data: items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getRawMaterialsByItemId = async (req, res) => {
  try {
    const { itemId } = req.query;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "itemId is required.",
      });
    }

    const rawMaterials = await prisma.itemRawMaterial.findMany({
      where: { itemId },
      select: {
        rawMaterial: {
          select: { id: true, name: true, unit: true },
        },
        quantity: true,
      },
    });

    if (!rawMaterials.length) {
      return res.status(404).json({
        success: false,
        message: "No raw materials found for the given item.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Raw materials fetched successfully for item.",
      data: rawMaterials,
    });
  } catch (error) {
    console.error("Error fetching raw materials:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addServiceRecord = async (req, res) => {
  try {
    const {
      item,
      subItem,
      quantity,
      serialNumber,
      faultAnalysis,
      initialRCA,
      isRepaired,
      repairedRejectedBy,
      remarks,
      repairedParts, // Array of objects: [{ rawMaterialId: "123", quantity: 2, unit: "pcs" }]
      //farmerSaralId,
      userId,
    } = req.body;

    // ✅ Basic validation
    if (
      !item ||
      !subItem ||
      !quantity ||
      !serialNumber ||
      !faultAnalysis ||
      !repairedRejectedBy ||
      !remarks ||
      !Array.isArray(repairedParts) ||
      repairedParts.length === 0 ||
      !userId
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const rawMaterialMap = {};
    const insufficientStock = [];

    // ✅ Check unit and stock for all raw materials before proceeding
    for (const part of repairedParts) {
      const { rawMaterialId, quantity, unit } = part;

      if (!rawMaterialMap[rawMaterialId]) {
        const rawMaterial = await prisma.rawMaterial.findUnique({
          where: { id: rawMaterialId },
        });

        if (!rawMaterial) {
          return res.status(404).json({
            success: false,
            message: `Raw Material with ID ${rawMaterialId} not found`,
          });
        }

        rawMaterialMap[rawMaterialId] = rawMaterial;
      }

      const rawMaterial = rawMaterialMap[rawMaterialId];

      // ✅ Unit check
      if (rawMaterial.unit !== unit) {
        return res.status(400).json({
          success: false,
          message: `Unit mismatch for ${rawMaterial.name}. Expected: ${rawMaterial.unit}, Provided: ${unit}`,
        });
      }

      // ✅ Stock check (only if item is being repaired)
      if (isRepaired && rawMaterial.stock < quantity) {
        insufficientStock.push({
          name: rawMaterial.name,
          available: rawMaterial.stock,
          required: quantity,
        });
      }
    }

    // ✅ If any stock is insufficient, abort and notify
    if (insufficientStock.length > 0) {
      console.error("Insufficient stock for raw materials:", insufficientStock);
      return res.status(400).json({
        success: false,
        message: `Insufficient stock for one or more raw materials. Details: ${insufficientStock} `,
        insufficientStock,
      });
    }

    // ✅ Proceed to create service record
    const serviceRecord = await prisma.serviceRecord.create({
      data: {
        item,
        subItem,
        quantity,
        serialNumber,
        initialRCA: initialRCA || null,
        faultAnalysis,
        isRepaired,
        repairedRejectedBy,
        remarks,
        //farmerSaralId,
        repairedParts,
        userId,
      },
    });

    // ✅ Update stock and log service usage
    for (const part of repairedParts) {
      const { rawMaterialId, quantity, unit } = part;
      const rawMaterial = rawMaterialMap[rawMaterialId];

      let updatedStock = rawMaterial.stock;

      if (isRepaired) {
        updatedStock = rawMaterial.stock - quantity;
      } else {
        updatedStock = rawMaterial.stock + quantity;
      }

      await prisma.rawMaterial.update({
        where: { id: rawMaterialId },
        data: { stock: updatedStock },
      });

      await prisma.serviceUsage.create({
        data: {
          serviceId: serviceRecord.id,
          rawMaterialId,
          quantityUsed: quantity,
          unit: unit,
        },
      });
    }

    // ✅ Call external API (non-blocking, errors handled)
    try {
      const response = await axios.post(
        `http://88.222.214.93:5000/common/update-item-defective?itemName=${subItem}&quantity=${quantity}&isRepaired=${isRepaired}`,
      );
      console.log("API Response:", response.data);
    } catch (apiError) {
      console.error("Error calling defective stock API:", apiError.message);
    }

    // ✅ Final success response
    return res.status(201).json({
      success: true,
      message: "Service record created successfully!",
      serviceRecord,
    });
  } catch (error) {
    console.error("Error adding service record:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create service record",
      error: error.message,
    });
  }
};

// const getItemRawMaterials = async (req, res) => {
//     const { subItem } = req.query;
//     console.log(subItem);
//     if (!subItem) {
//         return res.status(400).json({ success: false, error: "Item name is required" });
//     }

//     try {
//         const allItems = await prisma.item.findMany();
//         const lowerSubItem = subItem.toLowerCase();

//         // Try to find closest match manually
//         const matchedItem = allItems.find(item => {
//             const name = item.name.toLowerCase();
//             return lowerSubItem.includes(name) || name.includes(lowerSubItem);
//         });
//         console.log(matchedItem);

//         if (!matchedItem) {
//             return res.status(404).json({ success: false, message: "Item Not Found" });
//         }

//         const itemRawMaterials = await prisma.itemRawMaterial.findMany({
//             where: {
//                 itemId: matchedItem.id,
//             },
//             include: {
//                 rawMaterial: true,
//             },
//         });
//         console.log(itemRawMaterials);
//         const result = itemRawMaterials.map((entry) => ({
//             id: entry.rawMaterialId,
//             name: entry.rawMaterial.name,
//             quantity: entry.quantity,
//         }));

//         return res.status(200).json({
//             success: true,
//             message: "Raw Material Fetched Successfully",
//             data: result,
//         });

//     } catch (error) {
//         console.error("Error fetching raw materials:", error);
//         return res.status(500).json({
//             success: false,
//             message: "Internal Server Error",
//             error: error.message,
//         });
//     }
// };

// const addServiceRecord = async (req, res) => {
//   try {
//     const {
//       item,
//       subItem,
//       quantity,
//       serialNumber,
//       initialRCA,
//       faultAnalysis,
//       isRepaired,
//       repairedRejectedBy,
//       remarks,
//       repairedParts,
//       userId
//     } = req.body;
//     console.log("Req Body: ", req.body);
//     if (
//       !item || !subItem || !quantity || !serialNumber ||
//       !repairedParts || repairedParts.length === 0 ||
//       !repairedRejectedBy || !remarks || !userId
//     ) {
//       return res.status(400).json({ success: false, message: "All fields are required" });
//     }

//     const serviceRecord = await prisma.$transaction(async (tx) => {
//       // Validate item exists
//       let itemData;
//       if(subItem === "MOTOR 10HP AC 440V" || subItem === "MOTOR 10HP AC 380V"){
//         itemData = await tx.item.findFirst({ where: { name: "MOTOR 10HP AC" } });
//       }
//       else if ( subItem === "PUMP 10HP AC ") {
//         itemData = await tx.item.findFirst({ where: { name: subItem } });
//       }

//       if (!itemData) throw new Error(`${subItem} - Item not found`);

//       const finalRepairedParts = [];
//       const rawMaterialData = [];
//       const insufficientStock = [];

//       // Process repaired parts
//       for (const { rawMaterialId } of repairedParts) {
//         const itemRawMaterial = await tx.itemRawMaterial.findUnique({
//           where: { itemId_rawMaterialId: { itemId: itemData.id, rawMaterialId } },
//           include: { rawMaterial: true }
//         });

//         if (!itemRawMaterial) throw new Error(`No mapping found for item: ${subItem} & rawMaterialId: ${rawMaterialId}`);

//         const { rawMaterial, quantity: requiredQty } = itemRawMaterial;
//         if (!rawMaterial) throw new Error(`Raw Material with ID ${rawMaterialId} not found`);

//         if (isRepaired && rawMaterial.stock < requiredQty) {
//           insufficientStock.push({ name: rawMaterial.name, available: rawMaterial.stock, required: requiredQty });
//         }

//         finalRepairedParts.push({ rawMaterialId, quantity: requiredQty, unit: rawMaterial.unit });
//         rawMaterialData.push({ rawMaterialId, stock: rawMaterial.stock, requiredQty, unit: rawMaterial.unit });
//       }

//       if (insufficientStock.length > 0) {
//         throw new Error(`Insufficient stock: ${JSON.stringify(insufficientStock)}`);
//       }

//       // Create the service record
//       const record = await tx.serviceRecord.create({
//         data: {
//           item,
//           subItem,
//           quantity,
//           serialNumber,
//           initialRCA: initialRCA || null,       // Store JSON directly
//           faultAnalysis: faultAnalysis || null, // Store JSON directly
//           isRepaired,
//           repairedRejectedBy,
//           remarks,
//           repairedParts: finalRepairedParts,    // JSON array
//           userId
//         }
//       });

//       // Update stock + log usage
//       for (const part of rawMaterialData) {
//         const updatedStock = isRepaired ? part.stock - part.requiredQty : part.stock + part.requiredQty;

//         await tx.rawMaterial.update({
//           where: { id: part.rawMaterialId },
//           data: { stock: updatedStock }
//         });

//         await tx.serviceUsage.create({
//           data: {
//             serviceId: record.id,
//             rawMaterialId: part.rawMaterialId,
//             quantityUsed: part.requiredQty,
//             unit: part.unit
//           }
//         });
//       }

//       return record;
//     });

//     // Optional: call external API
//     try {
//       const response = await axios.post(
//         `http://88.222.214.93:5000/common/update-item-defective?itemName=${subItem}&quantity=${quantity}&isRepaired=${isRepaired}`
//       );
//       console.log("API Response:", response.data);
//     } catch (apiError) {
//       console.error("External API error:", apiError.message);
//     }

//     return res.status(201).json({ success: true, message: "Service record created successfully!", serviceRecord });

//   } catch (error) {
//     console.error("Error adding service record:", error);
//     return res.status(500).json({ success: false, message: "Failed to create service record", error: error.message });
//   }
// };

const getItemRawMaterials = async (req, res) => {
  const { subItem } = req.query;

  if (!subItem) {
    return res
      .status(400)
      .json({ success: false, error: "Item name is required" });
  }

  try {
    const keyword = subItem.toLowerCase().split(" ")[0]; // Extract keyword like "MOTOR"

    // Fetch all items
    const allItems = await prisma.item.findMany();

    // Filter items that contain the keyword
    const matchedItems = allItems.filter((item) =>
      item.name.toLowerCase().includes(keyword),
    );

    if (matchedItems.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No matching items found" });
    }

    const rawMaterialMap = new Map();

    for (const item of matchedItems) {
      const itemRawMaterials = await prisma.itemRawMaterial.findMany({
        where: {
          itemId: item.id,
        },
        include: {
          rawMaterial: true,
        },
      });

      for (const entry of itemRawMaterials) {
        const id = entry.rawMaterialId;

        // Avoid duplicates
        if (!rawMaterialMap.has(id)) {
          rawMaterialMap.set(id, {
            id,
            name: entry.rawMaterial.name,
            quantity: entry.quantity,
          });
        }
      }
    }

    const result = Array.from(rawMaterialMap.values());

    return res.status(200).json({
      success: true,
      message: "Unique Raw Materials Fetched Successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error fetching raw materials:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getRepairedServiceRecords = async (req, res) => {
  try {
    // Fetch service records based on isRepaired filter and sort by servicedAt
    const serviceRecords = await prisma.serviceRecord.findMany({
      where: { isRepaired: true },
      orderBy: { servicedAt: "desc" },
    });

    const result = await Promise.all(
      serviceRecords.map(async (record) => {
        // Handle both string and object cases for `repairedParts`
        const repairedParts = Array.isArray(record.repairedParts)
          ? record.repairedParts // Already parsed (if it's an object/array)
          : JSON.parse(record.repairedParts || "[]"); // Parse if it's a JSON string

        const rawMaterialDetails = await Promise.all(
          repairedParts.map(async (part) => {
            const rawMaterial = await prisma.rawMaterial.findUnique({
              where: { id: part.rawMaterialId },
            });
            return {
              rawMaterialId: part.rawMaterialId,
              rawMaterialName: rawMaterial?.name || "Unknown",
              quantity: part.quantity,
              unit: part.unit,
            };
          }),
        );

        return {
          ...record,
          repairedParts: rawMaterialDetails,
        };
      }),
    );

    res.status(200).json({
      success: true,
      message: `Repaired Service Records Fetched Successfully`,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getRejectedServiceRecords = async (req, res) => {
  try {
    // Fetch service records based on isRepaired filter and sort by servicedAt
    const serviceRecords = await prisma.serviceRecord.findMany({
      where: { isRepaired: false },
      orderBy: { servicedAt: "desc" },
    });

    const result = await Promise.all(
      serviceRecords.map(async (record) => {
        // Handle both string and object cases for `repairedParts`
        const repairedParts = Array.isArray(record.repairedParts)
          ? record.repairedParts // Already parsed (if it's an object/array)
          : JSON.parse(record.repairedParts || "[]"); // Parse if it's a JSON string

        const rawMaterialDetails = await Promise.all(
          repairedParts.map(async (part) => {
            const rawMaterial = await prisma.rawMaterial.findUnique({
              where: { id: part.rawMaterialId },
            });
            return {
              rawMaterialId: part.rawMaterialId,
              rawMaterialName: rawMaterial?.name || "Unknown",
              quantity: part.quantity,
              unit: part.unit,
            };
          }),
        );

        return {
          ...record,
          repairedParts: rawMaterialDetails,
        };
      }),
    );

    res.status(200).json({
      success: true,
      message: `Rejected Service Records Fetched Successfully`,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addUnit = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const unitName = name.trim(); // Trim only once

    // Check if item already exists
    const existingUnit = await prisma.unit.findUnique({
      where: { name: unitName },
    });

    if (existingUnit) {
      return res.status(400).json({
        success: false,
        message: "Unit Already Exists",
      });
    }

    const addUnit = await prisma.unit.create({
      data: {
        name: name,
      },
    });

    res.status(200).json({
      success: true,
      message: `Unit Added Successfully`,
      data: addUnit,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showUnit = async (req, res) => {
  try {
    const getUnit = await prisma.unit.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    res.status(200).json({
      success: true,
      message: `Units Fetched Successfully`,
      data: getUnit,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateItemRawMaterial = async (req, res) => {
  const { itemId, rawMaterialId, quantity, name } = req.body;

  if (!itemId || !rawMaterialId) {
    return res.status(400).json({
      success: false,
      message: "itemId and rawMaterialId are required",
    });
  }

  try {
    const updateData = {
      updatedBy: req.user.id,
    };

    // Check if the composite entry exists
    const existing = await prisma.itemRawMaterial.findUnique({
      where: {
        itemId_rawMaterialId: {
          itemId,
          rawMaterialId,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Item-RawMaterial link not found",
      });
    }

    // Update RawMaterial name if provided
    if (name) {
      await prisma.rawMaterial.update({
        where: { id: rawMaterialId },
        data: { name },
      });
    }

    // Update quantity if valid
    if (quantity !== undefined && quantity !== null && !isNaN(quantity)) {
      updateData.quantity = parseFloat(quantity);
    }

    // Update itemRawMaterial link
    await prisma.itemRawMaterial.update({
      where: {
        itemId_rawMaterialId: {
          itemId,
          rawMaterialId,
        },
      },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message: "Raw Material and/or Quantity updated successfully",
    });
  } catch (error) {
    console.error("Update Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const deleteItemRawMaterial = async (req, res) => {
  const { itemId, rawMaterialId } = req.body;

  if (!itemId || !rawMaterialId) {
    return res.status(400).json({
      success: false,
      message: "itemId and rawMaterialId are required to delete the row",
    });
  }

  try {
    await prisma.itemRawMaterial.delete({
      where: {
        itemId_rawMaterialId: {
          itemId,
          rawMaterialId,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "ItemRawMaterial row deleted successfully",
    });
  } catch (error) {
    console.error("Delete Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// const produceNewItem = async (req, res) => {
//     try {
//         const { itemId, subItem, quantityProduced, userId } = req.body;

//         const itemRawMaterials = await prisma.itemRawMaterial.findMany({
//             where: { itemId },
//             include: {
//                 rawMaterial: true
//             }
//         });

//         if (!itemRawMaterials.length) {
//             return res.status(404).json({ success: false, message: 'No raw materials linked to this item.' });
//         }

//         // 🛑 Step 1: Check stock availability before proceeding
//         const insufficientMaterials = itemRawMaterials.filter(rm => {
//             const requiredQty = (rm.quantity || 0) * quantityProduced;
//             return (rm.rawMaterial?.stock ?? 0) < requiredQty;
//         });

//         if (insufficientMaterials.length > 0) {
//             const message = insufficientMaterials.map(rm =>
//                 `Insufficient stock for ${rm.rawMaterial?.name ?? 'Unknown Material'} (required: ${(rm.quantity || 0) * quantityProduced}, available: ${rm.rawMaterial?.stock ?? 0})`
//             );
//             return res.status(400).json({
//                 success: false,
//                 message: "Not enough raw material to produce item.",
//                 details: message
//             });
//         }

//         const timestamp = new Date();
//         const stockUpdates = [];
//         const manufacturingUsages = [];

//         for (const rm of itemRawMaterials) {
//             const totalUsed = (rm.quantity || 0) * quantityProduced;

//             stockUpdates.push(
//                 prisma.rawMaterial.update({
//                     where: { id: rm.rawMaterialId },
//                     data: {
//                         stock: { decrement: totalUsed }
//                     }
//                 })
//             );

//             manufacturingUsages.push(
//                 prisma.manufacturingUsage.create({
//                     data: {
//                         itemId,
//                         rawMaterialId: rm.rawMaterialId,
//                         quantityUsed: totalUsed,
//                         unit: rm.rawMaterial?.unit ?? null,
//                         manufacturingDate: timestamp
//                     }
//                 })
//             );
//         }

//         const warehouseId = "67446a8b27dae6f7f4d985dd";
//         const warehouseItemsData = await WarehouseItems.findOne({ warehouse: warehouseId });

//         if (!warehouseItemsData) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Warehouse Items Data Not Found",
//             });
//         }

//         const itemIndex = warehouseItemsData.items.findIndex((item) => item.itemName === subItem);

//         if (itemIndex === -1) {
//             return res.status(404).json({
//                 success: false,
//                 message: "Item Not Found In Warehouse",
//             });
//         }

//         const itemToUpdate = warehouseItemsData.items[itemIndex];
//         const quantityToUpdate = parseInt(quantityProduced);
//         itemToUpdate.newStock += quantityToUpdate;
//         await warehouseItemsData.save();

//         await prisma.$transaction([
//             ...stockUpdates,
//             ...manufacturingUsages,
//             prisma.productionLog.create({
//                 data: {
//                     item: { connect: { id: itemId } },
//                     subItem,
//                     quantityProduced,
//                     manufacturingDate: timestamp,
//                     user: { connect: { id: userId } }
//                 }
//             })
//         ]);

//         return res.status(201).json({
//             success: true,
//             message: `Produced ${subItem}: ${quantityProduced} and updated warehouse stock.`
//         });
//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             message: "Internal Server Error",
//             error: error.message
//         });
//     }
// };

// const produceNewItem = async (req, res) => {
//   const session = await mongoose.startSession();
//   await session.startTransaction();

//   try {
//     const { itemId, subItem, quantityProduced, userId } = req.body;

//     const itemRawMaterials = await prisma.itemRawMaterial.findMany({
//       where: { itemId },
//       include: { rawMaterial: true },
//     });

//     if (!itemRawMaterials.length) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "No raw materials linked to this item.",
//       });
//     }

//     const insufficientMaterials = itemRawMaterials.filter((rm) => {
//       const requiredQty = (rm.quantity || 0) * quantityProduced;
//       return (rm.rawMaterial?.stock ?? 0) < requiredQty;
//     });

//     if (insufficientMaterials.length > 0) {
//       const message = insufficientMaterials.map(
//         (rm) =>
//           `Insufficient stock for ${
//             rm.rawMaterial?.name ?? "Unknown Material"
//           } (required: ${(rm.quantity || 0) * quantityProduced}, available: ${
//             rm.rawMaterial?.stock ?? 0
//           })`
//       );
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "Not enough raw material to produce item.",
//         details: message,
//       });
//     }

//     const timestamp = new Date();
//     const stockUpdates = [];
//     const manufacturingUsages = [];

//     for (const rm of itemRawMaterials) {
//       const totalUsed = (rm.quantity || 0) * quantityProduced;

//       stockUpdates.push(
//         prisma.rawMaterial.update({
//           where: { id: rm.rawMaterialId },
//           data: {
//             stock: { decrement: totalUsed },
//           },
//         })
//       );

//       manufacturingUsages.push(
//         prisma.manufacturingUsage.create({
//           data: {
//             itemId,
//             rawMaterialId: rm.rawMaterialId,
//             quantityUsed: totalUsed,
//             unit: rm.rawMaterial?.unit ?? null,
//             manufacturingDate: timestamp,
//           },
//         })
//       );
//     }

//     const warehouseId = "67446a8b27dae6f7f4d985dd";
//     const warehouseItemsData = await WarehouseItems.findOne({
//       warehouse: warehouseId,
//     }).session(session);
//     console.log(warehouseItemsData);
//     if (!warehouseItemsData) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Warehouse Items Data Not Found",
//       });
//     }

//     // ✅ Using find() instead of findIndex()
//     const itemToUpdate = warehouseItemsData.items.find(
//       (item) => item.itemName === subItem
//     );
//     console.log(itemToUpdate);
//     if (!itemToUpdate) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Item Not Found In Warehouse",
//       });
//     }

//     itemToUpdate.newStock += parseInt(quantityProduced);
//     await warehouseItemsData.save({ session });
//     let installatinInventory, existingItem;
//     if (subItem === "MOTOR 10HP AC 440V") {
//       installatinInventory = await prisma.installatinInventory
//         .findMany({
//           warehouseId: mongoose.Types.ObjectId("67446a8b27dae6f7f4d985dd"),
//         })
//         .populate({
//           path: "warehouseId",
//           select: {
//             _id: 1,
//             warehouse: 1,
//           },
//         })
//         .populate({
//           path: "systemItemId",
//           select: {
//             _id: 1,
//             itemName: 1,
//           },
//         });

//       existingItem =
//         installatinInventory.systemItemId.itemName === "MOTOR 10HP AC 440V";
//       existingItem.quantity =
//         parseInt(existingItem.quantity) + parseInt(quantityProduced);
//     }

//     if (
//       subItem === "PUMP 10HP AC 4INCH 30MTR" ||
//       subItem === "PUMP 10HP AC 2.5INCH 50MTR" ||
//       subItem === "PUMP 10HP AC 2INCH 70MTR" ||
//       subItem === "PUMP 10HP AC 2INCH 100MTR"
//     ) {
//       // Regex with optional INCH part
//       const pumpRegex = /^PUMP 10HP AC (?:\d+INCH )?(\d+MTR)$/i;

//       if (pumpRegex.test(subItem)) {
//         let installationInventory = await InstallationInventory.findOne({
//           warehouseId: mongoose.Types.ObjectId("67446a8b27dae6f7f4d985dd"),
//         })
//           .populate({
//             path: "warehouseId",
//             select: { _id: 1, warehouse: 1 },
//           })
//           .populate({
//             path: "systemItemId",
//             select: { _id: 1, itemName: 1 },
//           });

//         if (
//           installationInventory &&
//           pumpRegex.test(installationInventory.systemItemId?.itemName)
//         ) {
//           installationInventory.quantity =
//             parseInt(installationInventory.quantity) +
//             parseInt(quantityProduced);

//           await installationInventory.save();
//         }
//       }
//     }

//     if(subItem === "CONTROLLER 10HP AC GALO") {
//        installatinInventory = await prisma.installatinInventory
//         .findMany({
//           warehouseId: mongoose.Types.ObjectId("67446a8b27dae6f7f4d985dd"),
//         })
//         .populate({
//           path: "warehouseId",
//           select: {
//             _id: 1,
//             warehouse: 1,
//           },
//         })
//         .populate({
//           path: "systemItemId",
//           select: {
//             _id: 1,
//             itemName: 1,
//           },
//         });

//       existingItem =
//         installatinInventory.systemItemId.itemName === "Controller - RMU - 10HP AC GALO";
//       existingItem.quantity =
//         parseInt(existingItem.quantity) + parseInt(quantityProduced);
//     }

//     // 🔒 Prisma transaction execution
//     await prisma.$transaction([
//       ...stockUpdates,
//       ...manufacturingUsages,
//       prisma.productionLog.create({
//         data: {
//           item: { connect: { id: itemId } },
//           subItem,
//           quantityProduced,
//           manufacturingDate: timestamp,
//           user: { connect: { id: userId } },
//         },
//       }),
//     ]);

//     await session.commitTransaction();
//     session.endSession();

//     return res.status(201).json({
//       success: true,
//       message: `Produced ${subItem}: ${quantityProduced} and updated warehouse stock.`,
//     });
//   } catch (error) {
//     if (session.inTransaction()) {
//       await session.abortTransaction();
//     }
//     session.endSession();

//     return res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//       error: error.message,
//     });
//   }
// };

// const getItemsProducibleCount = async (req, res) => {
//     try {
//         const items = await prisma.item.findMany({
//             include: {
//                 rawMaterials: {
//                     include: {
//                         rawMaterial: true,
//                     },
//                 },
//             },
//         });

//         const results = items.map((item) => {
//             const itemRawMaterials = item.rawMaterials;

//             if (itemRawMaterials.length === 0) {
//                 return {
//                     itemId: item.id,
//                     itemName: item.name,
//                     maxProducibleUnits: 0,
//                 };
//             }

//             const producibleUnits = itemRawMaterials.map((irm) => {
//                 const requiredQty = irm.quantity ?? 0;
//                 const availableStock = irm.rawMaterial?.stock ?? 0;

//                 if (requiredQty === 0) return Infinity;
//                 return availableStock / requiredQty;
//             });

//             const minProducible = Math.floor(Math.min(...producibleUnits));

//             return {
//                 itemId: item.id,
//                 itemName: item.name,
//                 maxProducibleUnits: minProducible > 0 ? minProducible : 0
//             };
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Data Fetched Successfully",
//             results
//         });
//     } catch (error) {
//         return res.status(500).json({
//             success: false,
//             message: "Internal server error",
//             error: error.message
//         });
//     }
// };

//Also updating specific items stock in the installationInventory while producing the item
const produceNewItem = async (req, res) => {
  const session = await mongoose.startSession();
  await session.startTransaction();

  try {
    const { itemId, subItem, quantityProduced, userId } = req.body;

    // Prisma - get raw materials
    const itemRawMaterials = await prisma.itemRawMaterial.findMany({
      where: { itemId },
      include: { rawMaterial: true },
    });

    if (!itemRawMaterials.length) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "No raw materials linked to this item.",
      });
    }

    // Check stock availability
    const insufficientMaterials = itemRawMaterials.filter((rm) => {
      const requiredQty = (rm.quantity || 0) * quantityProduced;
      return (rm.rawMaterial?.stock ?? 0) < requiredQty;
    });

    if (insufficientMaterials.length > 0) {
      const message = insufficientMaterials.map(
        (rm) =>
          `Insufficient stock for ${rm.rawMaterial?.name ?? "Unknown Material"} 
          (required: ${(rm.quantity || 0) * quantityProduced}, available: ${
            rm.rawMaterial?.stock ?? 0
          })`,
      );
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Not enough raw material to produce item.",
        details: message,
      });
    }

    const timestamp = new Date();
    const stockUpdates = [];
    const manufacturingUsages = [];

    // Prepare stock decrements & usage logs
    for (const rm of itemRawMaterials) {
      const totalUsed = (rm.quantity || 0) * quantityProduced;

      stockUpdates.push(
        prisma.rawMaterial.update({
          where: { id: rm.rawMaterialId },
          data: { stock: { decrement: totalUsed } },
        }),
      );

      manufacturingUsages.push(
        prisma.manufacturingUsage.create({
          data: {
            itemId,
            rawMaterialId: rm.rawMaterialId,
            quantityUsed: totalUsed,
            unit: rm.rawMaterial?.unit ?? null,
            manufacturingDate: timestamp,
          },
        }),
      );
    }

    // Mongoose - update warehouse stock
    const warehouseId = "67446a8b27dae6f7f4d985dd";
    const warehouseItemsData = await WarehouseItems.findOne({
      warehouse: new mongoose.Types.ObjectId(warehouseId), // ✅ correct field
    }).session(session);

    if (!warehouseItemsData) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Warehouse Items Data Not Found",
      });
    }

    const itemToUpdate = warehouseItemsData.items.find(
      (item) => item.itemName === subItem,
    );
    if (!itemToUpdate) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Item Not Found In Warehouse",
      });
    }

    itemToUpdate.newStock += parseInt(quantityProduced);
    await warehouseItemsData.save({ session });

    // ✅ Handle installation inventory
    let installationInventory, existingItem;

    // MOTOR
    if (subItem === "MOTOR 10HP AC 440V") {
      installationInventory = await InstallationInventory.findOne({
        warehouseId: new mongoose.Types.ObjectId(warehouseId),
      })
        .populate({ path: "warehouseId", select: { _id: 1, warehouse: 1 } })
        .populate({ path: "systemItemId", select: { _id: 1, itemName: 1 } });

      if (
        installationInventory?.systemItemId?.itemName === "MOTOR 10HP AC 440V"
      ) {
        installationInventory.quantity =
          parseInt(installationInventory.quantity) + parseInt(quantityProduced);
        await installationInventory.save();
      }
    }

    // PUMP
    if (/^PUMP 10HP AC/.test(subItem)) {
      const pumpRegex = /^PUMP 10HP AC (?:\d+INCH )?(\d+MTR)$/i;

      if (pumpRegex.test(subItem)) {
        installationInventory = await InstallationInventory.findOne({
          warehouseId: new mongoose.Types.ObjectId(warehouseId),
        })
          .populate({ path: "warehouseId", select: { _id: 1, warehouse: 1 } })
          .populate({ path: "systemItemId", select: { _id: 1, itemName: 1 } });

        if (
          installationInventory &&
          pumpRegex.test(installationInventory.systemItemId?.itemName)
        ) {
          installationInventory.quantity =
            parseInt(installationInventory.quantity) +
            parseInt(quantityProduced);
          await installationInventory.save();
        }
      }
    }

    // CONTROLLER
    if (subItem === "CONTROLLER 10HP AC GALO") {
      installationInventory = await InstallationInventory.findOne({
        warehouseId: new mongoose.Types.ObjectId(warehouseId),
      })
        .populate({ path: "warehouseId", select: { _id: 1, warehouse: 1 } })
        .populate({ path: "systemItemId", select: { _id: 1, itemName: 1 } });

      if (
        installationInventory?.systemItemId?.itemName ===
        "Controller - RMU - 10HP AC GALO"
      ) {
        installationInventory.quantity =
          parseInt(installationInventory.quantity) + parseInt(quantityProduced);
        await installationInventory.save();
      }
    }

    // 🔒 Prisma transaction (raw material + production log)
    await prisma.$transaction([
      ...stockUpdates,
      ...manufacturingUsages,
      prisma.productionLog.create({
        data: {
          item: { connect: { id: itemId } },
          subItem,
          quantityProduced,
          manufacturingDate: timestamp,
          user: { connect: { id: userId } },
        },
      }),
    ]);

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: `Produced ${subItem}: ${quantityProduced} and updated warehouse stock.`,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    console.log("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getItemsProducibleCount = async (req, res) => {
  try {
    const { name } = req.query;

    const items = await prisma.item.findMany({
      include: {
        rawMaterials: {
          include: {
            rawMaterial: true,
          },
        },
      },
    });

    // Filter manually if name query param is passed
    const filteredItems = name
      ? items.filter((item) =>
          item.name.toLowerCase().includes(name.toLowerCase()),
        )
      : items;

    const results = filteredItems.map((item) => {
      const itemRawMaterials = item.rawMaterials;

      if (itemRawMaterials.length === 0) {
        return {
          itemId: item.id,
          itemName: item.name,
          maxProducibleUnits: 0,
        };
      }

      const producibleUnits = itemRawMaterials.map((irm) => {
        const requiredQty = irm.quantity ?? 0;
        const availableStock = irm.rawMaterial?.stock ?? 0;

        if (requiredQty === 0) return Infinity;
        return availableStock / requiredQty;
      });

      const minProducible = Math.floor(Math.min(...producibleUnits));

      return {
        itemId: item.id,
        itemName: item.name,
        maxProducibleUnits: minProducible > 0 ? minProducible : 0,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      results,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getInsufficientRawMaterials = async (req, res) => {
  try {
    const { itemId } = req.query; // or use req.params depending on your route

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required",
      });
    }

    const item = await prisma.item.findUnique({
      where: {
        id: itemId,
      },
      include: {
        rawMaterials: {
          include: {
            rawMaterial: true,
          },
        },
      },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const insufficientMaterials = item.rawMaterials
      .filter((irm) => {
        const requiredQty = irm.quantity ?? 0;
        const availableStock = irm.rawMaterial?.stock ?? 0;

        // If requiredQty is zero, skip it
        if (requiredQty === 0) return false;

        return availableStock < requiredQty;
      })
      .map((irm) => ({
        rawMaterialId: irm.rawMaterial?.id,
        rawMaterialName: irm.rawMaterial?.name,
        availableStock: irm.rawMaterial?.stock ?? 0,
        requiredQuantity: irm.quantity ?? 0,
      }));

    return res.status(200).json({
      success: true,
      message: "Insufficient raw materials fetched successfully",
      item: {
        itemId: item.id,
        itemName: item.name,
      },
      insufficientMaterials,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const showOverallRepairedOrRejectedData = async (req, res) => {
  try {
    // Subtract 5.5 hours to convert IST time to match UTC in DB
    const isRepaired = req.query.isRepaired === "1";
    const offsetMinutes = 330;

    const startOfToday = moment()
      .startOf("day")
      .subtract(offsetMinutes, "minutes")
      .toDate();

    const startOfWeek = moment()
      .startOf("week")
      .subtract(offsetMinutes, "minutes")
      .toDate();

    const startOfMonth = moment()
      .startOf("month")
      .subtract(offsetMinutes, "minutes")
      .toDate();

    const baseWhere = { isRepaired };

    const [total, daily, weekly, monthly] = await Promise.all([
      prisma.serviceRecord.count({ where: baseWhere }),
      prisma.serviceRecord.count({
        where: {
          ...baseWhere,
          servicedAt: { gte: startOfToday },
        },
      }),
      prisma.serviceRecord.count({
        where: {
          ...baseWhere,
          servicedAt: { gte: startOfWeek },
        },
      }),
      prisma.serviceRecord.count({
        where: {
          ...baseWhere,
          servicedAt: { gte: startOfMonth },
        },
      }),
    ]);

    res.status(201).json({
      success: true,
      message: `Daily, Weekly, Monthly, Totally ${
        isRepaired ? "Repaired" : "Rejected"
      } Data Fetched Successfully`,
      total: total,
      daily: daily,
      weekly: weekly,
      monthly: monthly,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showProductionSummary = async (req, res) => {
  try {
    const offsetMinutes = 330; // IST offset (5.5 hours)

    const startOfToday = moment()
      .startOf("day")
      .subtract(offsetMinutes, "minutes")
      .toDate();
    const startOfWeek = moment()
      .startOf("week")
      .subtract(offsetMinutes, "minutes")
      .toDate();
    const startOfMonth = moment()
      .startOf("month")
      .subtract(offsetMinutes, "minutes")
      .toDate();

    const [total, daily, weekly, monthly] = await Promise.all([
      prisma.productionLog.aggregate({
        _sum: { quantityProduced: true },
      }),
      prisma.productionLog.aggregate({
        _sum: { quantityProduced: true },
        where: { manufacturingDate: { gte: startOfToday } },
      }),
      prisma.productionLog.aggregate({
        _sum: { quantityProduced: true },
        where: { manufacturingDate: { gte: startOfWeek } },
      }),
      prisma.productionLog.aggregate({
        _sum: { quantityProduced: true },
        where: { manufacturingDate: { gte: startOfMonth } },
      }),
    ]);

    res.status(200).json({
      success: true,
      message: "Production Summary Fetched Successfully",
      total: total._sum.quantityProduced || 0,
      daily: daily._sum.quantityProduced || 0,
      weekly: weekly._sum.quantityProduced || 0,
      monthly: monthly._sum.quantityProduced || 0,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getAllProductionLogs = async (req, res) => {
  try {
    const logs = await prisma.productionLog.findMany({
      orderBy: {
        manufacturingDate: "desc", // Sort by latest date first
      },
      include: {
        item: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: logs || [],
    });
  } catch (error) {
    console.error("Error fetching production logs:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// const addBOM = async (req, res) => {
//   try {
//     const {itemId, rawMaterialList} = req?.body;
//     if(!itemId || !rawMaterialList || rawMaterialList.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "All fields are required"
//       });
//     }

//     for(let rawMaterial of rawMaterialList) {
//       const existingRawMaterial = await prisma.rawMaterial.findUnique({
//         where: {
//           id: rawMaterial.rawMaterialId
//         }
//       });

//       if(!existingRawMaterial) {
//         throw new Error(`Raw Material Data Not Found`);
//       }

//       const existingItemRawMaterial = await prisma.itemRawMaterial.findUnique({
//         where: {
//           itemId_rawMaterialId: {
//             itemId,
//             rawMaterialId: rawMaterial.rawMaterialId
//           }
//         }
//       });

//       if(existingItemRawMaterial) {
//         throw new Error("Data already exists")
//       }
//     }

//     for(let rawMaterial of rawMaterialList) {
//       await prisma.itemRawMaterial.create({
//         data: {
//           itemId,
//           rawMaterialId: rawMaterial.rawMaterialId,
//           quantity: rawMaterial.quantity
//         }
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "BOM Added Successfully"
//     });

//   } catch (error) {
//     console.log("ERROR: ", error);
//     return res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//       error: error.message
//     });
//   }
// };

const addBOM = async (req, res) => {
  try {
    const { itemId, rawMaterialList } = req.body;

    if (!itemId || !rawMaterialList || rawMaterialList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "itemId and rawMaterialList are required",
      });
    }

    // Get all rawMaterialIds from request
    const rawMaterialIds = rawMaterialList.map((r) => r.rawMaterialId);

    // 1. Check if all raw materials exist in one query
    const existingRawMaterials = await prisma.rawMaterial.findMany({
      where: { id: { in: rawMaterialIds } },
      select: { id: true },
    });

    const existingIds = existingRawMaterials.map((rm) => rm.id);

    // Find any invalid ids
    const invalidIds = rawMaterialIds.filter((id) => !existingIds.includes(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Raw Materials not found: ${invalidIds.join(", ")}`,
      });
    }

    // 2. Check if any (itemId, rawMaterialId) already exist
    const existingItemRawMaterials = await prisma.itemRawMaterial.findMany({
      where: {
        itemId,
        rawMaterialId: { in: rawMaterialIds },
      },
      select: { rawMaterialId: true },
    });

    if (existingItemRawMaterials.length > 0) {
      const duplicates = existingItemRawMaterials.map((e) => e.rawMaterialId);
      return res.status(400).json({
        success: false,
        message: `Duplicate BOM entries already exist for rawMaterials: ${duplicates.join(
          ", ",
        )}`,
      });
    }

    // 3. Insert all at once
    await prisma.itemRawMaterial.createMany({
      data: rawMaterialList.map((r) => ({
        itemId,
        rawMaterialId: r.rawMaterialId,
        quantity: r.quantity,
      })),
    });

    return res.status(200).json({
      success: true,
      message: "BOM added successfully",
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addBOMByExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel File Not Uploaded",
      });
    }

    const workbook = new ExcelJs.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const worksheet = workbook.worksheets[0];
    let itemId = null;
    let itemName = null;

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const currentItemName = row.getCell(1).value?.toString().trim();
      const rawMaterialName = row.getCell(2).value?.toString().trim();
      const quantity = parseFloat(row.getCell(3).value) || 0;
      const unit = row.getCell(4).value?.toString().trim();

      // Skip invalid rows
      if (!currentItemName || !rawMaterialName || quantity === 0) continue;

      // ✅ Case-insensitive lookup for Item
      if (!itemId) {
        itemName = currentItemName;

        let existingItem = await prisma.$queryRaw`
          SELECT * FROM Item WHERE LOWER(name) = LOWER(${itemName}) LIMIT 1;
        `;

        if (existingItem.length === 0) {
          existingItem = await prisma.item.create({
            data: { name: itemName },
          });
        } else {
          existingItem = existingItem[0];
        }

        itemId = existingItem.id;
      }

      // ✅ Case-insensitive lookup for Raw Material
      let rawMaterial = await prisma.$queryRaw`
        SELECT * FROM RawMaterial WHERE LOWER(name) = LOWER(${rawMaterialName}) LIMIT 1;
      `;

      if (rawMaterial.length === 0) {
        rawMaterial = await prisma.rawMaterial.create({
          data: {
            name: rawMaterialName,
            stock: 0,
            unit,
          },
        });
      } else {
        rawMaterial = rawMaterial[0];
      }

      // ✅ Upsert into ItemRawMaterial
      await prisma.itemRawMaterial.upsert({
        where: {
          itemId_rawMaterialId: {
            itemId,
            rawMaterialId: rawMaterial.id,
          },
        },
        update: {
          quantity,
          updatedAt: new Date(),
        },
        create: {
          itemId,
          rawMaterialId: rawMaterial.id,
          quantity,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "BOM uploaded successfully",
    });
  } catch (error) {
    console.error("ERROR in addBOMByExcel:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const detachRawMaterialFromItem = async (req, res) => {
  try {
    const { itemId, rawMaterialId } = req.body;

    if (!itemId || !rawMaterialId) {
      return res.status(400).json({
        success: false,
        message: "itemId and rawMaterialId are required",
        data: null,
      });
    }

    const deleted = await prisma.itemRawMaterial
      .delete({
        where: {
          itemId_rawMaterialId: {
            itemId,
            rawMaterialId,
          },
        },
      })
      .catch(() => null); // catch if not found

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Data not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data removed successfully",
      data: deleted,
    });
  } catch (error) {
    console.error("ERROR (detachRawMaterialFromItem):", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
      data: null,
    });
  }
};

const detachRawMaterialFromStage = async (req, res) => {
  try {
    const { stageId, rawMaterialId } = req.body;

    if (!stageId || !rawMaterialId) {
      return res.status(400).json({
        success: false,
        message: "stageId and rawMaterialId are required",
        data: null,
      });
    }

    const deleted = await prisma.stageRawMaterial
      .delete({
        where: {
          stageId_rawMaterialId: {
            stageId,
            rawMaterialId,
          },
        },
      })
      .catch(() => null); // catch if not found

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Data not found",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data removed successfully",
      data: deleted,
    });
  } catch (error) {
    console.error("ERROR (detachRawMaterialFromStage):", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
      data: null,
    });
  }
};

const updateBOM = async (req, res) => {
  try {
    const itemId = req?.query?.itemId;
    const { rawMaterialList } = req?.body;
    console.log("ItemId: ", itemId);
    console.log("RawMaterials: ", rawMaterialList);
    if (!itemId || !rawMaterialList || rawMaterialList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Incomplete Data",
      });
    }

    const existingRecords = await prisma.itemRawMaterial.findMany({
      where: {
        itemId: itemId,
      },
    });

    if (!existingRecords) {
      throw new Error("Record Not Found");
    }

    const result = await prisma.$transaction(async (tx) => {
      const existingIds = existingRecords.map((r) => r.rawMaterialId);
      const newIds = rawMaterialList.map((r) => r.rawMaterialId);

      const toRemove = existingRecords.filter(
        (r) => !newIds.includes(r.rawMaterialId),
      );
      await tx.itemRawMaterial.deleteMany({
        where: {
          itemId,
          rawMaterialId: { in: toRemove.map((r) => r.rawMaterialId) },
        },
      });

      const upserts = await Promise.all(
        rawMaterialList.map((rm) =>
          tx.itemRawMaterial.upsert({
            where: {
              itemId_rawMaterialId: {
                itemId,
                rawMaterialId: rm.rawMaterialId,
              },
            },
            update: {
              quantity: rm.quantity,
              //updatedBy: req?.user?.id
            },
            create: {
              itemId,
              rawMaterialId: rm.rawMaterialId,
              quantity: rm.quantity,
              //updatedBy: req?.user?.id
            },
          }),
        ),
      );
      return upserts;
    });

    return res.status(200).json({
      success: true,
      message: "BOM Updated Successfully",
      data: result,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

/****************** New System ******************************/
const addStage = async (req, res) => {
  try {
    const { name, description } = req?.body;
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existingStage = await prisma.$queryRaw`
            SELECT * FROM Stage
            WHERE LOWER(name) = LOWER(${name}) 
            LIMIT 1;
        `;

    if (existingStage.length > 0) {
      // Check if an entry exists
      return res.status(400).json({
        success: false,
        message: "Data already exists",
      });
    }

    const newStage = await prisma.stage.create({
      data: {
        name: name,
        description: description || null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Data added successfully",
      data: newStage,
    });
  } catch (error) {
    console.error("Error while adding stage: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addItemType = async (req, res) => {
  try {
    const name = req?.body?.name;
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existingItemType = await prisma.$queryRaw`
            SELECT * FROM ItemType
            WHERE LOWER(name) = LOWER(${name})
            LIMIT 1;
        `;
    if (existingItemType.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Data already exists",
      });
    }

    const newItemType = await prisma.itemType.create({
      data: {
        name: name,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Data added successfully",
      data: newItemType,
    });
  } catch (error) {
    console.error("Error while adding data: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const attachItemTypeWithStage = async (req, res) => {
  try {
    const { itemTypeId, stageId } = req.body;

    if (!itemTypeId || !stageId) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existingData = await prisma.itemType_Stage.findFirst({
      where: {
        itemTypeId,
        stageId,
      },
    });

    if (existingData) {
      return res.status(400).json({
        success: false,
        message: "Data already exists",
      });
    }

    const insertData = await prisma.itemType_Stage.create({
      data: {
        itemTypeId,
        stageId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Data added successfully",
      data: insertData,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const attachRawMaterialWithStage = async (req, res) => {
  try {
    const { stageId, rawMaterialList } = req.body;

    if (!stageId || !rawMaterialList || rawMaterialList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existingStage = await prisma.stage.findUnique({
      where: { id: stageId },
    });

    if (!existingStage) {
      return res.status(400).json({
        success: false,
        message: "Stage Not Found",
      });
    }

    const existingRawMaterials = await prisma.rawMaterial.findMany({
      where: { id: { in: rawMaterialList } },
      select: { id: true },
    });

    if (existingRawMaterials.length !== rawMaterialList.length) {
      return res.status(400).json({
        success: false,
        message: "One or more RawMaterials not found",
      });
    }

    const stageRawMaterials = rawMaterialList.map((rawMaterialId) => ({
      stageId,
      rawMaterialId,
    }));

    await prisma.stageRawMaterial.createMany({
      data: stageRawMaterials,
      skipDuplicates: true, // prevents duplicate (stageId, rawMaterialId)
    });

    return res.status(200).json({
      success: true,
      message: "Raw materials successfully attached to stage",
    });
  } catch (error) {
    console.log("ERROR ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateStageRawMaterial = async (req, res) => {
  try {
    const stageId = req?.query?.stageId;
    const { rawMaterialList } = req?.body;

    if (
      !stageId ||
      !Array.isArray(rawMaterialList) ||
      rawMaterialList.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "stageId and rawMaterialList are required",
      });
    }

    const existingRecords = await prisma.stageRawMaterial.findMany({
      where: { stageId },
    });

    const existingIds = existingRecords.map((r) => r.rawMaterialId);
    const newIds = rawMaterialList.map((r) => r.rawMaterialId);

    const toRemove = existingIds.filter((id) => !newIds.includes(id));

    const result = await prisma.$transaction(async (tx) => {
      // Remove old ones
      if (toRemove.length > 0) {
        await tx.stageRawMaterial.deleteMany({
          where: {
            stageId,
            rawMaterialId: { in: toRemove },
          },
        });
      }

      // Upsert new/updated ones
      const upserts = await Promise.all(
        rawMaterialList.map((rm) =>
          tx.stageRawMaterial.upsert({
            where: {
              stageId_rawMaterialId: {
                stageId,
                rawMaterialId: rm.rawMaterialId,
              },
            },
            update: {
              updatedAt: new Date(),
            },
            create: {
              stageId,
              rawMaterialId: rm.rawMaterialId,
            },
          }),
        ),
      );

      return { addedOrUpdated: upserts, removed: toRemove };
    });

    return res.status(200).json({
      success: true,
      message: "Stage-RawMaterial Data Updated Successfully",
      data: result,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

//  itemTypeId     String?
//   currentStageId String?
//   nextStageId    String?

const addStageFlow = async (req, res) => {
  try {
    const { productId, itemTypeId, currentStageId, nextStageId } = req?.body;
    if (!productId || !itemTypeId || !currentStageId || !nextStageId) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existingStageFlow = await prisma.stageFlow.findFirst({
      where: {
        productId,
        itemTypeId,
        currentStageId,
        nextStageId,
      },
    });

    if (existingStageFlow) {
      return res.status(400).json({
        success: false,
        message: "Data already exists",
      });
    }

    const newStageFlow = await prisma.stageFlow.create({
      data: {
        productId,
        itemTypeId,
        currentStageId,
        nextStageId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Data added successfully",
      data: newStageFlow,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const addFailureRedirectStage = async (req, res) => {
  try {
    const { productId, itemTypeId, failureReason, redirectStageId } = req?.body;
    if (!productId || !itemTypeId || !failureReason || !redirectStageId) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const existingData = await prisma.failureRedirect.findFirst({
      where: {
        productId,
        itemTypeId,
        failureReason,
        redirectStageId,
      },
    });

    if (existingData) {
      return res.status(400).json({
        success: false,
        message: "Data already exists",
      });
    }

    const newData = await prisma.failureRedirect.create({
      data: {
        productId,
        itemTypeId,
        failureReason,
        redirectStageId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Data inserted successfully",
      data: newData,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showStages = async (req, res) => {
  try {
    const getStage = await prisma.stage.findMany({
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: getStage || [],
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showProductType = async (req, res) => {
  try {
    const getProductType = await prisma.itemType.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        name: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: getProductType || [],
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showStagesByItemType = async (req, res) => {
  try {
    const itemTypeId = req?.query?.itemTypeId;

    if (!itemTypeId) {
      return res.status(400).json({
        success: false,
        message: "itemTypeId is required",
      });
    }

    const getStages = await prisma.itemType_Stage.findMany({
      where: {  
        itemTypeId: itemTypeId,
      },
      orderBy: {
        createdAt: "asc", // ascending order (earliest first)
      },
      select: {
        id: true,
        itemTypeId: true,
        stage: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Stages fetched successfully",
      data: getStages,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showStageFlow = async (req, res) => {
  try {
    const itemTypeId = req?.query?.itemTypeId;

    const getStageFlow = await prisma.stageFlow.findMany({
      where: {
        itemTypeId,
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        itemType: {
          select: {
            // id: true,
            name: true, // adjust based on your ItemType fields
          },
        },
        currentStage: {
          select: {
            // id: true,
            name: true,
            description: true,
          },
        },
        nextStage: {
          select: {
            // id: true,
            name: true,
            description: true,
          },
        },
      },
    });

    const flattenData = getStageFlow.map((data) => ({
      id: data.id,
      itemTypeId: data.itemTypeId,
      itemTypeName: data.itemType?.name || null,

      currentStageId: data.currentStageId,
      currentStageName: data.currentStage?.name || null,
      currentStageDescription: data.currentStage?.description || null,

      nextStageId: data.nextStageId,
      nextStageName: data.nextStage?.name || null,
      nextStageDescription: data.nextStage?.description || null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: flattenData,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showFailureRedirectStage = async (req, res) => {
  try {
    const itemTypeId = req?.query?.itemTypeId;
    if (!itemTypeId) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const failureRedirectData = await prisma.failureRedirect.findMany({
      where: {
        itemTypeId,
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        itemType: {
          select: {
            name: true,
          },
        },
        redirectStage: {
          select: {
            name: true,
            description: true,
          },
        },
      },
    });

    const normalizeData = failureRedirectData.map((data) => ({
      id: data?.id,
      itemTypeId: data?.itemTypeId,
      itemTypeName: data?.itemType?.name || null,

      failureReason: data?.failureReason,

      redirectStageId: data?.redirectStageId,
      redirectStageName: data?.redirectStage?.name || null,
      redirectStageDescription: data?.redirectStage?.description || null,
    }));

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: normalizeData,
    });
  } catch (error) {
    console.error("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showStockUpdateHistory = async (req, res) => {
  try {
    const stockUpdateHistory = await prisma.stockMovementBatch.findMany({
      include: {
        stockMovement: {
          include: {
            rawMaterial: true,
            user: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!stockUpdateHistory || stockUpdateHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No stock update history available",
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const formattedHistory = stockUpdateHistory.map((batch) => ({
      ...batch,
      billPhotos: batch.billPhotos
        ? batch.billPhotos.map((photo) => `${baseUrl}${photo}`)
        : [],
    }));

    return res.status(200).json({
      success: true,
      message: "Stock update history fetched successfully",
      data: formattedHistory,
    });
  } catch (error) {
    console.log("ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

//---------------- Payment Approval Controllers ---------------------//

const showDocsVerifiedPaymentRequests = async (req, res) => {
  try {
    const userRole = req.user?.role;

    if (!["Admin"].includes(userRole?.name)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const paymentRequests = await prisma.payment.findMany({
      where: {
        docApprovalStatus: true,
        docApprovedBy: { not: null },
        adminApprovalStatus: null,
        approvedByAdmin: null,
        paymentRejected: false,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        poId: true,
        amount: true,
        billpaymentType: true,
        paymentRequestedBy: true,
        createdAt: true,
        docApprovalStatus: true,
        docApprovalDate: true,
        docApprovalRemark: true,
        doc_ApprovedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        purchaseOrder: {
          select: {
            poNumber: true,
            companyName: true,
            vendorName: true,
            currency: true,
            otherCharges: true,
            gstType: true,
            totalGST: true,
            grandTotal: true,
            foreignGrandTotal: true,
            invoices: {
              select: {
                invoiceNumber: true,
                invoiceUrl: true,
              },
            },
            bills: {
              select: {
                invoiceNumber: true,
                fileUrl: true,
              },
            },
            items: {
              select: {
                itemName: true,
                itemSource: true,
                quantity: true,
                unit: true,
                rate: true,
                gstRate: true,
                total: true,
                amountInForeign: true,
              },
            },
          },
        },
        paymentCreatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const formatted = paymentRequests.map((r) => ({
      paymentRequestId: r.id,
      poId: r.poId,
      poNumber: r.purchaseOrder?.poNumber,
      companyName: companyShortName(r.purchaseOrder?.companyName),
      vendorName: r.purchaseOrder?.vendorName,
      currency: r.purchaseOrder?.currency,
      requestedAmount: Number(r.amount),
      billpaymentType: r.billpaymentType,
      paymentRequestedBy: r.paymentCreatedBy?.name,
      createdAt: r.createdAt,
      docsVerifiedBy: r.doc_ApprovedBy?.name,
      docsVerifyRemark: r.docApprovalRemark,
      docsVerifiedDate: r.docApprovalDate,
      items: r.purchaseOrder?.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        gstRate: item.gstRate ? item.gstRate.toFixed(2) : "N/A",
        totalAmount:
          r.purchaseOrder?.currency === "INR"
            ? item.total.toFixed(2)
            : item.amountInForeign,
      })),
      otherCharges: r.purchaseOrder?.otherCharges.reduce(
        (sum, charges) => sum + Number(charges.amount),
        0,
      ),
      gstType: r.purchaseOrder?.gstType,
      gstAmount: r.purchaseOrder.totalGST.toFixed(2),
      grandTotal:
        r.purchaseOrder?.currency === "INR"
          ? r.purchaseOrder?.grandTotal.toFixed(2)
          : r.purchaseOrder?.foreignGrandTotal,
      invoices:
        r.purchaseOrder?.invoices?.map((inv) => ({
          invoiceNumber: inv.invoiceNumber,
          invoiceUrl: inv.invoiceUrl,
        })) || [],
      warehouseBills:
        r.purchaseOrder?.bills?.map((bill) => ({
          invoiceNumber: bill.invoiceNumber,
          invoiceUrl: bill.fileUrl,
        })) || [],
    }));

    return res.status(200).json({
      success: true,
      message: "Payment requests verified by document team",
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error("ADMIN DOC VERIFIED PAYMENT REQUEST ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showDocsVerifiedPaymentRequests2 = async (req, res) => {
  try {
    const userRole = req.user?.role;

    if (!["Admin"].includes(userRole?.name)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const paymentRequests = await prisma.payment.findMany({
      where: {
        docApprovalStatus: true,
        docApprovedBy: { not: null },
        adminApprovalStatus: null,
        approvedByAdmin: null,
        paymentRejected: false,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        poId: true,
        amount: true,
        billpaymentType: true,
        paymentRequestedBy: true,
        createdAt: true,
        docApprovalStatus: true,
        docApprovalDate: true,
        docApprovalRemark: true,
        doc_ApprovedBy: {
          select: {
            id: true,
            name: true,
          },
        },
        purchaseOrder: {
          select: {
            poNumber: true,
            companyName: true,
            vendorName: true,
            currency: true,
            otherCharges: true,
            gstType: true,
            totalGST: true,
            grandTotal: true,
            foreignGrandTotal: true,
            invoices: {
              select: {
                invoiceNumber: true,
                invoiceUrl: true,
              },
            },
            bills: {
              select: {
                invoiceNumber: true,
                fileUrl: true,
              },
            },
            items: {
              select: {
                itemName: true,
                itemSource: true,
                quantity: true,
                unit: true,
                rate: true,
                gstRate: true,
                total: true,
                amountInForeign: true,
              },
            },
          },
        },
        paymentCreatedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // const formatted = paymentRequests.map((r) => ({
    //   paymentRequestId: r.id,
    //   poId: r.poId,
    //   poNumber: r.purchaseOrder?.poNumber,
    //   companyName: companyShortName(r.purchaseOrder?.companyName),
    //   vendorName: r.purchaseOrder?.vendorName,
    //   currency: r.purchaseOrder?.currency,
    //   requestedAmount: Number(r.amount),
    //   billpaymentType: r.billpaymentType,
    //   paymentRequestedBy: r.paymentCreatedBy?.name,
    //   createdAt: r.createdAt,
    //   docsVerifiedBy: r.doc_ApprovedBy?.name,
    //   docsVerifyRemark: r.docApprovalRemark,
    //   docsVerifiedDate: r.docApprovalDate,
    //   items: r.purchaseOrder?.items.map((item) => ({
    //     itemName: item.itemName,
    //     quantity: item.quantity,
    //     unit: item.unit,
    //     rate: item.rate,
    //     gstRate: item.gstRate ? item.gstRate.toFixed(2) : "N/A",
    //     totalAmount: r.purchaseOrder?.currency === "INR" ? item.total.toFixed(2) : item.amountInForeign,
    //   })),
    //   otherCharges: r.purchaseOrder?.otherCharges.reduce((sum, charges) => sum + Number(charges.amount), 0),
    //   gstType: r.purchaseOrder?.gstType,
    //   gstAmount: r.purchaseOrder.totalGST.toFixed(2),
    //   grandTotal: r.purchaseOrder?.currency === "INR" ? r.purchaseOrder?.grandTotal.toFixed(2) : r.purchaseOrder?.foreignGrandTotal,
    //   invoices: r.purchaseOrder?.invoices?.map((inv) => ({
    //     invoiceNumber: inv.invoiceNumber,
    //     invoiceUrl: inv.invoiceUrl,
    //   })) || [],
    //   warehouseBills: r.purchaseOrder?.bills?.map((bill) => ({
    //     invoiceNumber: bill.invoiceNumber,
    //     invoiceUrl: bill.fileUrl
    //   })) || [],
    // }));

    // const groupedByVendor = {};

    // paymentRequests.forEach((r) => {
    //   const vendor = r.purchaseOrder?.vendorName || "Unknown Vendor";

    //   if (!groupedByVendor[vendor]) {
    //     groupedByVendor[vendor] = {
    //       vendorName: vendor,
    //       companyName: companyShortName(r.purchaseOrder?.companyName),
    //       currency: r.purchaseOrder?.currency,
    //       totalRequestedAmount: 0,
    //       payments: [], // optional: keep individual records
    //     };
    //   }

    //   groupedByVendor[vendor].totalRequestedAmount += Number(r.amount);

    //   groupedByVendor[vendor].payments.push({
    //     paymentRequestId: r.id,
    //     poId: r.poId,
    //     poNumber: r.purchaseOrder?.poNumber,
    //     requestedAmount: Number(r.amount),
    //     billpaymentType: r.billpaymentType,
    //     paymentRequestedBy: r.paymentCreatedBy?.name,
    //     createdAt: r.createdAt,
    //     docsVerifiedBy: r.doc_ApprovedBy?.name,
    //     docsVerifyRemark: r.docApprovalRemark,
    //     docsVerifiedDate: r.docApprovalDate,

    //     items: r.purchaseOrder?.items.map((item) => ({
    //       itemName: item.itemName,
    //       quantity: item.quantity,
    //       unit: item.unit,
    //       rate: item.rate,
    //       gstRate: item.gstRate ? item.gstRate.toFixed(2) : "N/A",
    //       totalAmount:
    //         r.purchaseOrder?.currency === "INR"
    //           ? item.total.toFixed(2)
    //           : item.amountInForeign,
    //     })),

    //     otherCharges: r.purchaseOrder?.otherCharges.reduce(
    //       (sum, charges) => sum + Number(charges.amount),
    //       0,
    //     ),

    //     gstType: r.purchaseOrder?.gstType,
    //     gstAmount: r.purchaseOrder.totalGST.toFixed(2),
    //     grandTotal:
    //       r.purchaseOrder?.currency === "INR"
    //         ? r.purchaseOrder?.grandTotal.toFixed(2)
    //         : r.purchaseOrder?.foreignGrandTotal,

    //     invoices:
    //       r.purchaseOrder?.invoices?.map((inv) => ({
    //         invoiceNumber: inv.invoiceNumber,
    //         invoiceUrl: inv.invoiceUrl,
    //       })) || [],

    //     warehouseBills:
    //       r.purchaseOrder?.bills?.map((bill) => ({
    //         invoiceNumber: bill.invoiceNumber,
    //         invoiceUrl: bill.fileUrl,
    //       })) || [],
    //   });
    // });

    // const formatted = Object.values(groupedByVendor);

    const groupedByVendor = {};

    paymentRequests.forEach((r) => {
      const vendor = r.purchaseOrder?.vendorName || "Unknown Vendor";
      console.log(vendor);
      const currency = r.purchaseOrder?.currency || "UNKNOWN";
      console.log(currency)

      const groupKey = `${vendor}__${currency}`;

      if (!groupedByVendor[groupKey]) {
        groupedByVendor[groupKey] = {
          vendorName: vendor,
          companyName: companyShortName(r.purchaseOrder?.companyName),
          currency: currency,
          totalRequestedAmount: 0,
          payments: [],
        };
      }

      groupedByVendor[groupKey].totalRequestedAmount += Number(r.amount);

      groupedByVendor[groupKey].payments.push({
        paymentRequestId: r.id,
        poId: r.poId,
        poNumber: r.purchaseOrder?.poNumber,
        requestedAmount: Number(r.amount),
        billpaymentType: r.billpaymentType,
        paymentRequestedBy: r.paymentCreatedBy?.name,
        createdAt: r.createdAt,
        docsVerifiedBy: r.doc_ApprovedBy?.name,
        docsVerifyRemark: r.docApprovalRemark,
        docsVerifiedDate: r.docApprovalDate,

        items: r.purchaseOrder?.items.map((item) => ({
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          gstRate: item.gstRate ? item.gstRate.toFixed(2) : "N/A",
          totalAmount:
            currency === "INR" ? item.total.toFixed(2) : item.amountInForeign,
        })),

        otherCharges: r.purchaseOrder?.otherCharges.reduce(
          (sum, charges) => sum + Number(charges.amount),
          0,
        ),

        gstType: r.purchaseOrder?.gstType,
        gstAmount: r.purchaseOrder.totalGST.toFixed(2),
        grandTotal:
          currency === "INR"
            ? r.purchaseOrder?.grandTotal.toFixed(2)
            : r.purchaseOrder?.foreignGrandTotal,

        invoices:
          r.purchaseOrder?.invoices?.map((inv) => ({
            invoiceNumber: inv.invoiceNumber,
            invoiceUrl: inv.invoiceUrl,
          })) || [],

        warehouseBills:
          r.purchaseOrder?.bills?.map((bill) => ({
            invoiceNumber: bill.invoiceNumber,
            invoiceUrl: bill.fileUrl,
          })) || [],
      });
    });

    const formatted = Object.values(groupedByVendor);

    return res.status(200).json({
      success: true,
      message: "Payment requests verified by document team",
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error("ADMIN DOC VERIFIED PAYMENT REQUEST ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// const approveOrRejectPaymentRequestByAdmin = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     const userRole = req.user?.role;

//     if (!["Admin"].includes(userRole.name)) {
//       return res.status(403).json({
//         success: false,
//         message: "Unauthorized access",
//       });
//     }

//     const { paymentRequestId, status, remarks } = req.body;

//     if (!paymentRequestId || !status) {
//       return res.status(400).json({
//         success: false,
//         message: "paymentRequestId and status are required",
//       });
//     }

//     if (!["APPROVED", "REJECTED"].includes(status.toUpperCase())) {
//       return res.status(400).json({
//         success: false,
//         message: "Status must be APPROVED or REJECTED",
//       });
//     }

//     const payment = await prisma.payment.findUnique({
//       where: { id: paymentRequestId }
//     });

//     if (!payment) {
//       return res.status(404).json({
//         success: false,
//         message: "Payment request not found",
//       });
//     }

//     if (payment.adminApprovalStatus !== null) {
//       return res.status(400).json({
//         success: false,
//         message: "Payment already processed",
//       });
//     }

//     // Update
//     const updated = await prisma.payment.update({
//       where: { id: paymentRequestId },
//       data: {
//         adminApprovalStatus: status.toUpperCase() === "APPROVED" ? true : false,
//         adminApprovalDate: new Date(),
//         adminRemark: remarks.trim() || null,
//         approvedByAdmin: userId
//       },
//     });

//     return res.status(200).json({
//       success: true,
//       message: `Payment request ${status.toLowerCase()} successfully`,
//       data: updated,
//     });

//   } catch (error) {
//     console.error("Handle Payment Request ERROR:", error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//       error: error.message,
//     });
//   }
// };

const approveOrRejectMultiplePaymentsByAdmin = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userRole || userRole.name !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const { paymentRequestIds, status, remarks } = req.body;

    if (
      !Array.isArray(paymentRequestIds) ||
      paymentRequestIds.length === 0 ||
      !status
    ) {
      return res.status(400).json({
        success: false,
        message: "paymentRequestIds (array) and status are required",
      });
    }

    if (!["APPROVED", "REJECTED"].includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: "Status must be APPROVED or REJECTED",
      });
    }

    // ✅ Fetch only pending payments
    const pendingPayments = await prisma.payment.findMany({
      where: {
        id: { in: paymentRequestIds },
        adminApprovalStatus: null,
        OR: [{ paymentRejected: false }, { paymentRejected: null }],
      },
    });

    if (pendingPayments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No pending payment requests found",
      });
    }

    // ✅ Bulk update
    const result = await prisma.payment.updateMany({
      where: {
        id: { in: pendingPayments.map((p) => p.id) },
      },
      data: {
        adminApprovalStatus: status.toUpperCase() === "APPROVED",
        adminApprovalDate: new Date(),
        adminRemark: remarks?.trim() || null,
        approvedByAdmin: userId,
        updatedBy: userId,
      },
    });

    return res.status(200).json({
      success: true,
      message: `${result.count} payment requests ${status.toLowerCase()} successfully`,
      approvedCount: result.count,
      skippedCount: paymentRequestIds.length - result.count,
    });
  } catch (error) {
    console.error("Bulk Payment Approval ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getPOsForAdminApproval = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { vendorId, fromDate, toDate } = req.query;

    const where = {
      status: "Approval_Sent",
      approvalStatus: "Pending",
    };

    if (vendorId) {
      where.vendorId = vendorId;
    }

    if (fromDate || toDate) {
      where.poDate = {};
      if (fromDate) where.poDate.gte = new Date(fromDate);
      if (toDate) where.poDate.lte = new Date(toDate);
    }

    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { poDate: "desc" },
        select: {
          id: true,
          poNumber: true,
          poDate: true,
          companyId: true,
          companyName: true,
          vendorId: true,
          vendorName: true,
          currency: true,
          gstType: true,
          totalGST: true,
          otherCharges: true,
          grandTotal: true,
          foreignGrandTotal: true,
          status: true,
          approvalStatus: true,
          createdBy: true,
          user: { select: { id: true, name: true } },
          items: {
            select: {
              id: true,
              itemId: true,
              itemSource: true,
              itemName: true,
              quantity: true,
              unit: true,
              rate: true,
              gstRate: true,
              total: true,
              amountInForeign: true,
            },
          },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    const formattedData = data.map((po) => ({
      poId: po.id,
      poNumber: po.poNumber,
      companyId: po.companyId,
      companyName: po.companyName,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      currency: po.currency,
      status: po.status,
      approvalStatus: po.approvalStatus,
      createdBy: po.user
        ? { id: po.user.id, name: po.user.name }
        : po.createdBy
          ? { id: po.createdBy, name: null }
          : null,
      poDate: po.poDate,
      gstType: po.gstType,
      items: po.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        gstRate: item.gstRate ? item.gstRate.toFixed(2) : "N/A",
        totalAmount:
          po.currency === "INR" ? item.total.toFixed(2) : item.amountInForeign,
      })),
      otherCharges: po.otherCharges.reduce(
        (sum, charges) => sum + Number(charges.amount),
        0,
      ),
      totalGST: po.totalGST ? po.totalGST.toFixed(2) : "N/A",
      grandTotal:
        po.currency === "INR" ? po.grandTotal.toFixed(2) : po.foreignGrandTotal,
    }));

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalRecords: total,
      data: formattedData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const poApprovalAction = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { poId, status, rejectionReason } = req.body;

    if (userRole?.name !== "Admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required.",
      });
    }
    if (!poId || !status) {
      return res.status(400).json({
        success: false,
        message: "Validation failed: poId and status are required.",
      });
    }

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Allowed values are APPROVED or REJECTED.",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: { status: true },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Purchase order not found.",
      });
    }

    if (po.status !== "Approval_Sent") {
      return res.status(400).json({
        success: false,
        message: "Purchase order is not pending for approval.",
      });
    }

    const updateData =
      status === "APPROVED"
        ? {
            status: "Admin_Approved",
            approvalStatus: "Approved",
            approvedAt: new Date(),
            approvedBy: userId,
          }
        : {
            status: "Admin_Rejected",
            approvalStatus: "Rejected",
            rejectedBy: userId,
            rejectedAt: new Date(),
            rejectionReason: rejectionReason || "Rejected by admin",
          };

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: updateData,
    });

    res.json({
      success: true,
      message:
        status === "APPROVED"
          ? "PO approved successfully"
          : "PO rejected successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const previewPOPdf = async (req, res) => {
  try {
    const { poId } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not found.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!["Admin", "Verification", "Accounts"].includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message:
          "Access Denied: Only Admin, Accounts & Verification is allowed to preview PO.",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { company: true, vendor: true, items: true },
    });

    if (!po) {
      return res.status(404).json({ success: false, message: "PO not found." });
    }

    // Freeze item values exactly as stored
    const items = po.items.map((it) => ({
      itemName: it.itemName,
      hsnCode: it.hsnCode || "-",
      quantity: Number(it.quantity),
      modelNumber: it.modelNumber || null,
      itemDetail: it.itemDetail || null,
      unit: it.unit || "Nos",
      rate: Number(it.rate),
      total: Number(it.total),
      gstRate: it.gstRate ? Number(it.gstRate) : 0,
      rateInForeign: it.rateInForeign ? Number(it.rateInForeign) : null,
      amountInForeign: it.amountInForeign ? Number(it.amountInForeign) : null,
    }));

    const pdfBuffer = await generatePO(po, items);

    // sanitize vendor name
    const vendor = po.vendor.name.split(" ")[0];
    const fileName = `${vendor}-PO-${po.poNumber}.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": Buffer.byteLength(pdfBuffer),
      "Content-Disposition": `inline; filename="${fileName}"`,
    });

    return res.end(pdfBuffer);
  } catch (err) {
    console.error("❌ Error generating PO PDF:", err.stack || err);
    return res.status(500).json({
      success: false,
      message: "Server Error while generating PO PDF",
      error: err.message,
    });
  }
};

//Version 2 - controllers

const getPOsForAdminApproval2 = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { vendorId, fromDate, toDate } = req.query;

    const where = {
      status: "Approval_Sent",
      approvalStatus: "Pending",
    };

    if (vendorId) {
      where.vendorId = vendorId;
    }

    if (fromDate || toDate) {
      where.poDate = {};
      if (fromDate) where.poDate.gte = new Date(fromDate);
      if (toDate) where.poDate.lte = new Date(toDate);
    }

    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: { poDate: "desc" },
        select: {
          id: true,
          poNumber: true,
          poDate: true,
          companyId: true,
          companyName: true,
          vendorId: true,
          vendorName: true,
          currency: true,
          gstType: true,
          totalGST: true,
          otherCharges: true,
          grandTotal: true,
          foreignGrandTotal: true,
          status: true,
          approvalStatus: true,
          items: {
            select: {
              id: true,
              itemId: true,
              itemSource: true,
              itemName: true,
              quantity: true,
              unit: true,
              rate: true,
              gstRate: true,
              total: true,
              amountInForeign: true,
            },
          },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    const formattedData = data.map((po) => ({
      poId: po.id,
      poNumber: po.poNumber,
      companyId: po.companyId,
      companyName: po.companyName,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      currency: po.currency,
      status: po.status,
      approvalStatus: po.approvalStatus,
      poDate: po.poDate,
      gstType: po.gstType,
      items: po.items.map((item) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        gstRate: item.gstRate ? item.gstRate.toFixed(2) : "N/A",
        totalAmount:
          po.currency === "INR" ? item.total.toFixed(2) : item.amountInForeign,
      })),
      otherCharges: po.otherCharges.reduce(
        (sum, charges) => sum + Number(charges.amount),
        0,
      ),
      totalGST: po.totalGST ? po.totalGST.toFixed(2) : "N/A",
      grandTotal:
        po.currency === "INR" ? po.grandTotal.toFixed(2) : po.foreignGrandTotal,
    }));

    return res.status(200).json({
      success: true,
      page,
      limit,
      totalRecords: total,
      data: formattedData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};



// ---------------new 

module.exports = {
  showEmployees,
  deactivateEmployee,
  activateEmployee,
  addItem,
  addRawMaterial,
  showItems,
  showRawMaterials,
  deleteItem,
  deleteAllRawMaterials,
  addWarehouse,
  updateRawMaterialStock,
  getItemsByName,
  getRawMaterialsByItemId,
  getDefectiveItemsForWarehouse,
  addServiceRecord,
  getRepairedServiceRecords,
  getRejectedServiceRecords,
  getItemRawMaterials,
  addUnit,
  showUnit,
  attachItemToRawMaterial,
  updateItemRawMaterial,
  deleteItemRawMaterial,
  produceNewItem,
  getItemsProducibleCount,
  getInsufficientRawMaterials,
  showOverallRepairedOrRejectedData,
  showProductionSummary,
  getAllProductionLogs,
  addBOM,
  addBOMByExcel,
  updateBOM,
  addStage,
  addItemType,
  attachItemTypeWithStage,
  attachRawMaterialWithStage,
  updateStageRawMaterial,
  addStageFlow,
  addFailureRedirectStage,
  showStages,
  showProductType,
  showStagesByItemType,
  showStageFlow,
  showFailureRedirectStage,
  showStockUpdateHistory,
  detachRawMaterialFromItem,
  detachRawMaterialFromStage,
  showDocsVerifiedPaymentRequests,
  approveOrRejectMultiplePaymentsByAdmin,
  getPOsForAdminApproval,
  poApprovalAction,
  previewPOPdf,
  getPOsForAdminApproval2,
  showDocsVerifiedPaymentRequests2,
};
