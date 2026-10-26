const prisma = require("../../config/prismaClient");
const fs = require("fs/promises");
const path = require("path");
const Warehouse = require("../../models/serviceInventoryModels/warehouseSchema");
const SystemItem = require("../../models/systemInventoryModels/systemItemSchema");
const InstallationInventory = require("../../models/systemInventoryModels/installationInventorySchema");
const SystemOrder = require("../../models/systemInventoryModels/systemOrderSchema");
const System = require("../../models/systemInventoryModels/systemSchema");
const { default: mongoose } = require("mongoose");

const getPumpHead = (itemName = "") => {
  const heads = ["30M", "50M", "70M", "100M"];
  return heads.find((h) => itemName.includes(h)) || null;
};

const getLineWorkerList = async (req, res) => {
  try {
    const empId = req.user?.id;
    const userWarehouseId = req.user?.warehouseId;
    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "EmpId Not Found",
      });
    }

    const empData = await prisma.user.findFirst({
      where: {
        id: empId,
      },
      include: {
        role: true,
      },
    });
    const validRoles = ["Store", "Production"];
    if (!validRoles.includes(empData?.role?.name)) {
      return res.status(400).json({
        success: false,
        message:
          "Only Store Keeper & Production Have Access To The Line-Workers",
      });
    }


    // const userData = await prisma.user.findMany({
    //   where: {
    //     warehouseId: userWarehouseId,
    //     role: {
    //       is: {
    //         name: {
    //           notIn: [
    //             "Admin",
    //             "SuperAdmin",
    //             "Store",
    //             "Purchase",
    //             "Accounts",
    //             "Verification",
    //             "Production",
    //           ],
    //         },
    //       },
    //     },
    //     isActive: true,
    //   },
    //   orderBy: {
    //     name: "asc",
    //   },
    //   select: {
    //     id: true,
    //     name: true,
    //     role: {
    //       select: {
    //         id: true,
    //         name: true,
    //       },
    //     },
    //   },
    // });
    const userData = await prisma.user.findMany({
  where: {
    warehouseId: userWarehouseId,
    isActive: true,
  },
  orderBy: {
    name: "asc",
  },
  select: {
    id: true,
    name: true,
    warehouseId: true,
    isActive: true,
    role: {
      select: {
        id: true,
        name: true,
      },
    },
  },
});

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: userData || [],
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

const formatStock = (value) => {
  if (value % 1 === 0) {
    return value; // integer → return as it is
  }
  return Number(value.toFixed(2)); // decimals → 2 digits
};

const getRawMaterialList = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    const allRawMaterial = await prisma.rawMaterial.findMany({
      select: {
        id: true,
        name: true,
        unit: true,
        warehouseStock: {
          where: {
            warehouseId,
          },
          select: {
            quantity: true,
            isUsed: true,
          },
        },
      },
    });

    const formattedData = allRawMaterial.map((data) => {
      const warehouseData = data.warehouseStock[0] || {};

      const stock = warehouseData.quantity ?? 0;
      const isUsed = warehouseData.isUsed ?? false;

      return {
        id: data.id,
        name: data.name,
        stock: formatStock(stock),
        rawStock: stock, // only for sorting
        unit: data.unit,
        isUsed,
        outOfStock: stock === 0,
      };
    });

    const sortedData = formattedData.sort((a, b) => {
      if (a.isUsed === b.isUsed) {
        return a.rawStock - b.rawStock;
      }
      return a.isUsed ? -1 : 1;
    });

    const cleanedData = sortedData.map(({ rawStock, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      message: "Raw material fetched successfully",
      data: cleanedData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getWarehouseRawMaterialList = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouseId;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user.",
      });
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not found.",
      });
    }



    // -------------------------------------------
    const inventoryItems = await InstallationInventory.find({ warehouseId })
      .populate("systemItemId", "itemName unit isUsed")
      .lean();


    let totalDesired = 0;

    const commonItems = [];

    inventoryItems.forEach((item) => {
      if (!item.systemItemId) return;

      const pumpHead = getPumpHead(item.systemItemId.itemName);
      if (!pumpHead) {
        commonItems.push(item);
      }
    });

    const inventoryMap = new Map();

    inventoryItems.forEach((item) => {
      if (!item.systemItemId) return;
      const key = item.systemItemId._id.toString();
      inventoryMap.set(key, (inventoryMap.get(key) || 0) + item.quantity);
    });


    /* =====================================================
       STEP 5: COMMON ITEMS
    ===================================================== */
    const commonItemsResponse = commonItems.map((item) => {
      const itemId = item.systemItemId._id.toString();
      const stockQty = inventoryMap.get(itemId) || 0;

      return {
        id: item.systemItemId._id,
        name: item.systemItemId.itemName,
        stock: stockQty,
        unit: item.systemItemId.unit,
        isUsed: item.systemItemId.isUsed
      };
    });

    const installationData = commonItemsResponse.map(item => {

      return {
        id: item.id,
        name: item.name,
        stock: item.stock,
        unit: item?.unit,
        isUsed: item?.isUsed,
        type: "INSTALLATION"
      };
    });


    // console.log(commonItemsResponse)
    // -------------------------------------------

    // 1. Fetch from WarehouseStock instead
    const warehouseData = await prisma.warehouseStock.findMany({
      where: {
        warehouseId: warehouseId,
      },
      include: {
        rawMaterial: {
          select: {
            name: true,
            isUsed: true,
          },
        },
      },
    });


    // 2. Format the data to match your previous response structure
    const formattedData = warehouseData.map((item) => {
      // Fallback to 0 if quantity is null/undefined
      const stock = item.quantity ?? 0;

      return {
        id: item.rawMaterialId, // Using the material ID
        name: item.rawMaterial?.name || "Unknown",
        stock: formatStock(stock),
        rawStock: stock, // used for sorting
        unit: item.unit,
        isUsed: item.isUsed ?? item.rawMaterial?.isUsed,
      };
    });

    // 3. Keep your existing sorting logic
    const sortedData = formattedData.sort((a, b) => {
      if (a.isUsed === b.isUsed) {
        return a.rawStock - b.rawStock;
      }
      return a.isUsed ? -1 : 1;
    });

    // 4. Remove helper field for the final response
    // const cleanedData = sortedData.map(({ rawStock, ...rest }) => rest);

    const cleanedData = sortedData.map(({ rawStock, ...rest }) => ({
      ...rest,
      type: "RAW_MATERIAL"
    }));

    const data = [
      ...cleanedData,
      ...installationData
    ].sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      message: `${warehouse.warehouseName} raw material fetched successfully`,
      data: data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showIncomingItemRequest = async (req, res) => {
  try {
    const empId = req.query?.empId;
    if (!empId) {
      throw new Error("Employee Id Not Found");
    }

    const empData = await prisma.user.findFirst({
      where: {
        id: req?.user?.id,
      },
      include: {
        role: true,
      },
    });

    if (empData?.role?.name !== "Store") {
      return res.status(400).json({
        success: false,
        message: "Only Store Keeper Have Access For Incoming Item Request",
      });
    }

    const incomingItemRequest = await prisma.itemRequestData.findMany({
      where: {
        requestedBy: empId,
        //approved: null,
      },
      select: {
        id: true,
        warehouseId: true,
        serviceProcessId: true,
        isProcessRequest: true,
        rawMaterialRequested: true,
        requestedBy: true,
        requestedAt: true,
        approved: true,
        approvedBy: true,
        approvedAt: true,
        materialGiven: true,
        declined: true,
        declinedBy: true,
        declinedAt: true,
        declinedRemarks: true,
      },
      orderBy: {
        requestedAt: "desc",
      },
    });
    const withNames = await Promise.all(
      incomingItemRequest.map(async (req) => {
        const materials = req.rawMaterialRequested || [];

        // get all rawMaterialIds
        const ids = materials.map((m) => m.rawMaterialId);

        const rawMaterials = await prisma.rawMaterial.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, unit: true },
        });

        // attach names
        const enriched = materials.map((m) => {
          const match = rawMaterials.find((r) => r.id === m.rawMaterialId);
          return {
            ...m,
            name: match?.name || "Unknown",
            unit: match?.unit || null,
          };
        });

        return { ...req, rawMaterialRequested: enriched };
      }),
    );

    res.json({
      success: true,
      message: "Data fetched successfully",
      data: withNames,
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

const approveOrDeclineItemRequest = async (req, res) => {
  try {
    const { itemRequestId, action, remarks } = req.body;
    const userId = req?.user?.id;

    if (!itemRequestId || !action) {
      return res.status(400).json({
        success: false,
        message: "itemRequestId and action are required",
      });
    }

    if (action === "DECLINE") {
      if (!remarks) {
        return res.status(400).json({
          success: false,
          message: `Action - ${action}, remarks is required.`,
        });
      }
    }

    if (!["APPROVE", "DECLINE"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Allowed: APPROVE, DECLINE",
      });
    }

    const itemRequest = await prisma.itemRequestData.findFirst({
      where: { id: itemRequestId },
    });

    if (!itemRequest) {
      return res
        .status(404)
        .json({ success: false, message: "Item request not found" });
    }

    if (itemRequest.approved || itemRequest.declined) {
      return res.status(400).json({
        success: false,
        message: "Item request already processed",
      });
    }

    const now = new Date();

    let updateData = {
      updatedBy: userId,
      updatedAt: now,
    };

    if (action === "APPROVE") {
      updateData = {
        ...updateData,
        approved: true,
        approvedBy: userId,
        approvedAt: now,
      };
    }

    if (action === "DECLINE") {
      updateData = {
        ...updateData,
        declined: true,
        declinedBy: userId,
        declinedAt: now,
        declinedRemarks: remarks || null,
      };
    }

    const updated = await prisma.itemRequestData.update({
      where: { id: itemRequestId },
      data: updateData,
    });

    return res.status(200).json({
      success: true,
      message:
        action === "APPROVE"
          ? "Item Request Approved Successfully"
          : "Item Request Declined Successfully",
      data: updated,
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

const sanctionItemForRequest = async (req, res) => {
  try {
    const { itemRequestId } = req.body;
    const warehouseId = req.user?.warehouseId;

    if (!itemRequestId) {
      return res.status(400).json({
        success: false,
        message: "ItemRequestId Not Found",
      });
    }

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    const itemRequestData = await prisma.itemRequestData.findFirst({
      where: { id: itemRequestId },
    });

    if (!itemRequestData) throw new Error("Item request not found");
    if (itemRequestData.approved === null)
      throw new Error("Item request is not approved.");
    if (itemRequestData.declined === true)
      throw new Error("Item request is declined.");
    if (itemRequestData.materialGiven)
      throw new Error("Material already sanctioned");

    const rawMaterials = itemRequestData.rawMaterialRequested;
    if (!Array.isArray(rawMaterials) || rawMaterials.length === 0) {
      throw new Error("No raw material data found in the request");
    }

    const date = new Date();

    const result = await prisma.$transaction(async (tx) => {
      for (const rawMaterial of rawMaterials) {
        // 1️⃣ Validate raw material master
        const rawMaterialData = await tx.rawMaterial.findFirst({
          where: { id: rawMaterial.rawMaterialId },
        });

        if (!rawMaterialData) {
          throw new Error(
            `Raw material not found for ID: ${rawMaterial.rawMaterialId}`,
          );
        }

        // 2️⃣ Get warehouse stock
        const warehouseStock = await tx.warehouseStock.findFirst({
          where: {
            warehouseId,
            rawMaterialId: rawMaterial.rawMaterialId,
          },
        });

        if (!warehouseStock) {
          throw new Error(
            `Stock not available in warehouse for ${rawMaterialData.name}`,
          );
        }

        if (Number(warehouseStock.quantity) < Number(rawMaterial.quantity)) {
          throw new Error(
            `Can't sanction! Requested quantity for ${rawMaterialData.name} exceeds warehouse stock`,
          );
        }

        // 3️⃣ Decrease warehouse stock
        await tx.warehouseStock.update({
          where: { id: warehouseStock.id },
          data: {
            quantity: {
              decrement: Number(rawMaterial.quantity),
            },
          },
        });

        // 4️⃣ Credit user stock
        const existingUserItemStock = await tx.userItemStock.findFirst({
          where: {
            empId: itemRequestData.requestedBy,
            rawMaterialId: rawMaterial.rawMaterialId,
          },
        });

        if (existingUserItemStock) {
          await tx.userItemStock.update({
            where: { id: existingUserItemStock.id },
            data: {
              quantity: {
                increment: Number(rawMaterial.quantity),
              },
            },
          });
        } else {
          await tx.userItemStock.create({
            data: {
              empId: itemRequestData.requestedBy,
              rawMaterialId: rawMaterial.rawMaterialId,
              quantity: Number(rawMaterial.quantity),
              unit: rawMaterial.unit,
            },
          });
        }
      }

      // 5️⃣ Mark request as sanctioned
      return tx.itemRequestData.update({
        where: { id: itemRequestId },
        data: {
          materialGiven: true,
          updatedAt: date,
          updatedBy: req.user.id,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Material sanctioned from warehouse successfully",
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

const getUserItemStock = async (req, res) => {
  try {
    const empId = req?.query?.empId;
    if (!empId) throw new Error("Employee ID Not Found");

    const safeParse = (value) => {
      try {
        if (!value) return [];
        if (typeof value === "string") return JSON.parse(value);
        if (Array.isArray(value)) return value;
        if (typeof value === "object") return [value];
        return [];
      } catch (err) {
        console.error("❌ JSON PARSE FAILED:", err.message);
        return [];
      }
    };

    /* ======================
     * 1️⃣ BALANCE SUMMARY
     * ====================== */
    const balanceRaw = await prisma.userItemStock.findMany({
      where: { empId, quantity: { gt: 0 } },
      select: {
        rawMaterial: { select: { id: true, name: true } },
        quantity: true,
        unit: true,
      },
    });

    const balanceSummary = balanceRaw.map((item) => ({
      rawMaterialId: item.rawMaterial.id,
      rawMaterialName: item.rawMaterial.name,
      quantity: item.quantity,
      unit: item.unit,
    }));

    /* ======================
     * 2️⃣ DIRECT ISSUES
     * ====================== */
    const directRaw = await prisma.directItemIssue.findMany({
      where: { issuedTo: empId },
      select: {
        id: true,
        rawMaterialIssued: true,
        issuedAt: true,
        remarks: true,
        issuedToUser: { select: { name: true } },
        issuedByUser: { select: { name: true } },
        issuedToName: true,
      },
      orderBy: { issuedAt: "desc" },
    });

    const issueRMIds = directRaw.flatMap((i) =>
      safeParse(i.rawMaterialIssued).map((rm) => rm.rawMaterialId),
    );

    /* ======================
     * 3️⃣ REQUEST HISTORY
     * ====================== */
    const requestRaw = await prisma.itemRequestData.findMany({
      where: { requestedBy: empId },
      select: {
        id: true,
        rawMaterialRequested: true,
        requestedAt: true,
        approvedAt: true,
        declinedAt: true,
        approved: true,
        declined: true,
        materialGiven: true,
        declinedRemarks: true,
        requestedByUser: { select: { name: true } },
        approvedByUser: { select: { name: true } },
        declinedByUser: { select: { name: true } },
      },
      orderBy: { requestedAt: "desc" },
    });

    const requestRMIds = requestRaw.flatMap((r) =>
      safeParse(r.rawMaterialRequested).map((rm) => rm.rawMaterialId),
    );

    /* ======================
     * FETCH RM NAMES ONCE
     * ====================== */
    const allRMIds = [...new Set([...issueRMIds, ...requestRMIds])];

    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { id: { in: allRMIds } },
      select: { id: true, name: true },
    });

    const RM_LOOKUP = Object.fromEntries(
      rawMaterials.map((rm) => [rm.id, rm.name]),
    );

    /* ======================
     * FORMAT ISSUES
     * ====================== */
    const directIssues = directRaw.map((issue) => ({
      id: issue.id,
      items: safeParse(issue.rawMaterialIssued).map((rm) => ({
        rawMaterialId: rm.rawMaterialId,
        rawMaterialName: RM_LOOKUP[rm.rawMaterialId] || "Unknown",
        quantity: rm.quantity,
        unit: rm.unit,
      })),
      issuedBy: issue.issuedByUser?.name || "Unknown",
      issuedTo: issue.issuedToName || issue.issuedToUser?.name || null,
      issuedDate: issue.issuedAt,
      remarks: issue.remarks || null,
    }));

    /* ======================
     * FORMAT REQUEST HISTORY
     * ====================== */
    const requestHistory = requestRaw.map((r) => ({
      id: r.id,
      items: safeParse(r.rawMaterialRequested).map((rm) => ({
        rawMaterialId: rm.rawMaterialId,
        rawMaterialName: RM_LOOKUP[rm.rawMaterialId] || "Unknown",
        quantity: rm.quantity,
        unit: rm.unit,
      })),
      requestedBy: r.requestedByUser?.name || null,
      requestedDate: r.requestedAt,
      approvedBy: r.approvedByUser?.name || null,
      approvedDate: r.approvedAt,
      declinedBy: r.declinedByUser?.name || null,
      declinedDate: r.declinedAt,
      declinedRemarks: r.declinedRemarks || null,
      status: r.declined ? "DECLINED" : r.approved ? "APPROVED" : "PENDING",
      materialGiven: !!r.materialGiven,
    }));

    return res.status(200).json({
      success: true,
      message: `Data fetched successfully`,
      data: {
        balanceSummary: balanceSummary,
        directItemsIssued: directIssues,
        itemsRequested: requestHistory,
      },
    });
  } catch (error) {
    console.log("❌ ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getUserItemStockDetails = async (req, res) => {
  try {
    const empId = req?.query?.empId;
    if (!empId) throw new Error("Employee ID Not Found");

    const safeParse = (value) => {
      try {
        if (!value) return [];
        if (typeof value === "string") return JSON.parse(value);
        if (Array.isArray(value)) return value;
        if (typeof value === "object") return [value];
        return [];
      } catch (err) {
        console.error("❌ JSON PARSE FAILED:", err.message);
        return [];
      }
    };

    /* ======================
     * 1️⃣ BALANCE SUMMARY
     * ====================== */
    const balanceRaw = await prisma.userItemStock.findMany({
      where: { empId, quantity: { gt: 0 } },
      select: {
        rawMaterial: { select: { id: true, name: true } },
        quantity: true,
        unit: true,
      },
    });

    const balanceSummary = balanceRaw.map((item) => ({
      rawMaterialId: item.rawMaterial.id,
      rawMaterialName: item.rawMaterial.name,
      quantity: item.quantity,
      unit: item.unit,
    }));

    /* ======================
     * 2️⃣ DIRECT ISSUES
     * ====================== */
    const directRaw = await prisma.directItemIssue.findMany({
      where: { issuedTo: empId },
      select: {
        id: true,
        rawMaterialIssued: true,
        issuedAt: true,
        remarks: true,
        issuedToUser: { select: { name: true } },
        issuedByUser: { select: { name: true } },
        issuedToName: true,
      },
      orderBy: { issuedAt: "desc" },
    });

    const issueRMIds = directRaw.flatMap((i) =>
      safeParse(i.rawMaterialIssued).map((rm) => rm.rawMaterialId),
    );

    /* ======================
     * 3️⃣ REQUEST HISTORY
     * ====================== */
    const requestRaw = await prisma.itemRequestData.findMany({
      where: { requestedBy: empId },
      select: {
        id: true,
        rawMaterialRequested: true,
        requestedAt: true,
        approvedAt: true,
        declinedAt: true,
        approved: true,
        declined: true,
        materialGiven: true,
        declinedRemarks: true,
        requestedByUser: { select: { name: true } },
        approvedByUser: { select: { name: true } },
        declinedByUser: { select: { name: true } },
      },
      orderBy: { requestedAt: "desc" },
    });

    const requestRMIds = requestRaw.flatMap((r) =>
      safeParse(r.rawMaterialRequested).map((rm) => rm.rawMaterialId),
    );

    /* ======================
     * FETCH RM NAMES ONCE
     * ====================== */
    const allRMIds = [...new Set([...issueRMIds, ...requestRMIds])];

    const rawMaterials = await prisma.rawMaterial.findMany({
      where: { id: { in: allRMIds } },
      select: { id: true, name: true },
    });

    const RM_LOOKUP = Object.fromEntries(
      rawMaterials.map((rm) => [rm.id, rm.name]),
    );

    /* ======================
     * FORMAT ISSUES
     * ====================== */
    const directIssues = directRaw.map((issue) => ({
      id: issue.id,
      items: safeParse(issue.rawMaterialIssued).map((rm) => ({
        rawMaterialId: rm.rawMaterialId,
        rawMaterialName: RM_LOOKUP[rm.rawMaterialId] || "Unknown",
        quantity: rm.quantity,
        unit: rm.unit,
      })),
      issuedBy: issue.issuedByUser?.name || "Unknown",
      issuedTo: issue.issuedToName || issue.issuedToUser?.name || null,
      issuedDate: issue.issuedAt,
      remarks: issue.remarks || null,
    }));

    /* ======================
     * FORMAT REQUEST HISTORY
     * ====================== */
    const requestHistory = requestRaw.map((r) => ({
      id: r.id,
      items: safeParse(r.rawMaterialRequested).map((rm) => ({
        rawMaterialId: rm.rawMaterialId,
        rawMaterialName: RM_LOOKUP[rm.rawMaterialId] || "Unknown",
        quantity: rm.quantity,
        unit: rm.unit,
      })),
      requestedBy: r.requestedByUser?.name || null,
      requestedDate: r.requestedAt,
      approvedBy: r.approvedByUser?.name || null,
      approvedDate: r.approvedAt,
      declinedBy: r.declinedByUser?.name || null,
      declinedDate: r.declinedAt,
      declinedRemarks: r.declinedRemarks || null,
      status: r.declined ? "DECLINED" : r.approved ? "APPROVED" : "PENDING",
      materialGiven: !!r.materialGiven,
    }));

    return res.status(200).json({
      success: true,
      data: {
        balanceSummary: balanceSummary,
        directItemsIssued: directIssues,
        itemsRequested: requestHistory,
      },
    });
  } catch (error) {
    console.log("❌ ERROR: ", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const showProcessData = async (req, res) => {
  try {
    const {
      filterType,
      startDate,
      endDate,
      status,
      stageId,
      itemTypeId,
      search,
      page = 1,
      limit = 15,
    } = req.query;

    const warehouseId = req.user?.warehouseId;
    const userRole = req.user?.role;
    const isAdmin = userRole?.name === "Admin";

    if (!isAdmin && !warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    let filterConditions = { AND: [] };

    // ---------- UTIL ----------
    const ISTtoUTC = (date) => new Date(date.getTime() - 5.5 * 60 * 60 * 1000);

    const now = new Date();
    const todayIST = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ---------- DATE FILTER ----------
    const setDateFilter = () => {
      let startIST, endIST;

      switch (filterType) {
        case "Today":
          startIST = todayIST;
          endIST = new Date(todayIST);
          endIST.setHours(23, 59, 59, 999);
          break;

        case "Week":
          startIST = new Date(todayIST);
          startIST.setDate(todayIST.getDate() - 6);
          endIST = now;
          break;

        case "Month":
          startIST = new Date(now.getFullYear(), now.getMonth(), 1);
          endIST = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59,
            999,
          );
          break;

        case "Year":
          startIST = new Date(now.getFullYear(), 0, 1);
          endIST = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
          break;

        case "Custom":
          if (!startDate || !endDate) {
            throw new Error(
              "Start date and end date required for Custom filter",
            );
          }
          startIST = new Date(startDate);
          endIST = new Date(endDate);
          endIST.setHours(23, 59, 59, 999);
          break;

        default:
          return;
      }

      filterConditions.AND.push({
        createdAt: {
          gte: ISTtoUTC(startIST),
          lte: ISTtoUTC(endIST),
        },
      });
    };

    setDateFilter();
    if (!isAdmin) {
      filterConditions.AND.push({ warehouseId });
    }

    // ---------- BASIC FILTERS ----------
    if (status) filterConditions.AND.push({ status });
    if (stageId) filterConditions.AND.push({ stageId });
    if (itemTypeId) filterConditions.AND.push({ itemTypeId });

    // ---------- SEARCH ----------
    if (search?.trim()) {
      const s = search.trim().toUpperCase();
      filterConditions.AND.push({
        OR: [{ item: s }, { subItem: s }, { serialNumber: s }],
      });
    }

    // ---------- PAGINATION ----------
    const skip = (Number(page) - 1) * Number(limit);

    // ---------- QUERY ----------
    const [processData, total] = await Promise.all([
      prisma.service_Process_Record.findMany({
        where: filterConditions,
        orderBy: { createdAt: "asc" },
        skip,
        take: Number(limit),
        select: {
          id: true,
          productName: true,
          itemName: true,
          subItemName: true,
          itemType: { select: { id: true, name: true } },
          serialNumber: true,
          quantity: true,
          stage: { select: { id: true, name: true } },
          status: true,
          createdAt: true,
          stageActivity: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              status: true,
              acceptedAt: true,
              startedAt: true,
              completedAt: true,
              isCurrent: true,
              failureReason: true,
              remarks: true,
              stage: { select: { id: true, name: true } },
              user: { select: { id: true, name: true } },
            },
          },
        },
      }),

      prisma.service_Process_Record.count({ where: filterConditions }),
    ]);

    // ---------- FORMAT ----------
    const modifiedData = processData.map((p) => ({
      serviceProcessId: p.id,
      productName: p.productName,
      itemName: p.itemName,
      subItemName: p.subItemName,
      itemType: p.itemType?.name,
      serialNumber: p.serialNumber,
      quantity: p.quantity,
      currentStage: p.stage?.name,
      processStatus: p.status,
      createdAt: p.createdAt,
      stageActivities: p.stageActivity.map((a) => ({
        activityId: a.id,
        stageId: a.stage.id,
        stageName: a.stage.name,
        activityStatus: a.status,
        isCurrent: a.isCurrent,
        failureReason: a.failureReason,
        remarks: a.remarks,
        acceptedAt: a.acceptedAt,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
      })),
    }));

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
      data: modifiedData,
    });
  } catch (error) {
    console.log("ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateStock = async (req, res) => {
  const uploadFiles = [];
  try {
    const empId = req?.user?.id;
    const warehouseId = req?.user?.warehouseId;
    const rawMaterialList = req?.body?.rawMaterialList;

    if (!empId || !warehouseId) {
      throw new Error("User or Warehouse not found");
    }

    if (!rawMaterialList) {
      throw new Error("Raw material list is required");
    }

    if (!req.files || !req.files.billPhoto) {
      throw new Error("Bill photo file not uploaded");
    }

    // Upload bill photos
    const billPhotoUrl = req.files.billPhoto.map((file) => {
      uploadFiles.push(file.path);
      return `/uploads/rawMaterial/billPhoto/${file.filename}`;
    });

    const parsedRawMaterialList = JSON.parse(rawMaterialList);

    if (
      !Array.isArray(parsedRawMaterialList) ||
      parsedRawMaterialList.length === 0
    ) {
      throw new Error("Raw material list is empty or invalid");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create stock movement batch
      const addBillPhoto = await tx.stockMovementBatch.create({
        data: {
          billPhotos: billPhotoUrl,
          createdBy: empId,
        },
      });

      for (const rawMaterial of parsedRawMaterialList) {
        const quantity = Number(rawMaterial.quantity);

        if (!rawMaterial.rawMaterialId || isNaN(quantity) || quantity <= 0) {
          throw new Error(
            "Invalid rawMaterial data: rawMaterialId and valid quantity required",
          );
        }

        const existingRawMaterial = await tx.rawMaterial.findUnique({
          where: { id: rawMaterial.rawMaterialId },
        });

        if (!existingRawMaterial) {
          throw new Error(
            `Raw Material not found: ${rawMaterial.rawMaterialId}`,
          );
        }

        // 🔹 Stock Movement (no warehouse relation now)
        await tx.stockMovement.create({
          data: {
            batchId: addBillPhoto.id,
            rawMaterialId: rawMaterial.rawMaterialId,
            userId: empId,
            warehouseId, // just a string now
            quantity,
            unit: existingRawMaterial.unit,
            type: "IN",
          },
        });

        // 🔹 Warehouse Stock UPSERT
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_rawMaterialId: {
              warehouseId,
              rawMaterialId: rawMaterial.rawMaterialId,
            },
          },
          update: {
            quantity: { increment: quantity },
            unit: existingRawMaterial.unit,
          },
          create: {
            warehouseId,
            rawMaterialId: rawMaterial.rawMaterialId,
            quantity,
            unit: existingRawMaterial.unit,
            isUsed: true,
          },
        });
      }

      return addBillPhoto;
    });

    return res.status(200).json({
      success: true,
      message: "Stock updated successfully",
      data: result,
    });
  } catch (error) {
    console.log("ERROR: ", error);

    // Cleanup uploaded files if transaction fails
    if (uploadFiles.length > 0) {
      await Promise.all(
        uploadFiles.map(async (filePath) => {
          try {
            await fs.unlink(filePath);
            console.log(`🗑 Deleted uploaded file: ${filePath}`);
          } catch (unlinkErr) {
            console.error(`Failed to delete file ${filePath}:`, unlinkErr);
          }
        }),
      );
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getStockMovementHistory = async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const warehouseId = req?.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not found for user",
      });
    }

    const batches = await prisma.stockMovementBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        stockMovement: {
          where: {
            warehouseId: warehouseId, // ✅ FILTER HERE
          },
          select: {
            rawMaterial: {
              select: {
                id: true,
                name: true,
              },
            },
            quantity: true,
            unit: true,
            type: true,
          },
        },
      },
    });

    // Optional (recommended):
    // remove batches with no movements for this warehouse
    const filteredBatches = batches.filter(
      (batch) => batch.stockMovement.length > 0,
    );

    const formattedBatches = filteredBatches.map((batch) => ({
      ...batch,
      billPhotos: batch.billPhotos
        ? batch.billPhotos.map((photo) => `${baseUrl}${photo}`)
        : [],
    }));

    return res.status(200).json({
      success: true,
      message: "Stock movement history fetched successfully",
      data: formattedBatches,
    });
  } catch (error) {
    console.error("Error fetching stock movement history:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const markRawMaterialUsedOrNotUsed = async (req, res) => {
  try {
    const { id, isUsed, warehouseId: queryWarehouseId } = req.query;

    const empId = req.user?.id;

    const warehouseId = queryWarehouseId || req.user?.warehouseId;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "RawMaterial Id is required.",
      });
    }

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not found",
      });
    }

    if (isUsed === undefined) {
      return res.status(400).json({
        success: false,
        message: "isUsed value is required",
      });
    }

    const isUsedBoolean = isUsed === "true";

    /**
     * STEP 1: Verify warehouse ownership & fetch snapshot
     */
    const warehouseStock = await prisma.warehouseStock.findFirst({
      where: {
        rawMaterialId: id,
        warehouseId,
      },
      include: {
        rawMaterial: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
      },
    });

    if (!warehouseStock) {
      return res.status(403).json({
        success: false,
        message: "Warehouse stock not found.",
      });
    }

    if (warehouseStock.isUsed === isUsedBoolean) {
      return res.status(400).json({
        success: false,
        message: `RawMaterial is already marked as ${isUsedBoolean ? "Used" : "Not Used"
          }`,
      });
    }

    const updatedWarehouseStock = await prisma.warehouseStock.update({
      where: {
        id: warehouseStock.id,
      },
      data: {
        isUsed: isUsedBoolean,
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "WarehouseStock",
        entityId: warehouseStock.id,
        action: isUsedBoolean ? "MARKED_USED" : "MARKED_NOT_USED",
        performedBy: empId || null,

        oldValue: {
          warehouseId: warehouseId,
          rawMaterialId: warehouseStock.rawMaterialId,
          rawMaterialName: warehouseStock.rawMaterial?.name || null,
          unit: warehouseStock.rawMaterial?.unit || null,
          quantity: warehouseStock.quantity,
          isUsed: warehouseStock.isUsed,
        },

        newValue: {
          warehouseId: warehouseId,
          rawMaterialId: warehouseStock.rawMaterialId,
          rawMaterialName: warehouseStock.rawMaterial?.name || null,
          unit: warehouseStock.rawMaterial?.unit || null,
          quantity: warehouseStock.quantity,
          isUsed: isUsedBoolean,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `RawMaterial marked as ${isUsedBoolean ? "Used." : "Not Used."}`,
      data: updatedWarehouseStock,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const markSystemItemUsedOrNotUsed = async (req, res) => {
  try {
    const { id, isUsed } = req.query;
    const empId = req.user?.id;

    if (!id || typeof isUsed === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Invalid data passed",
      });
    }

    const existingSystemItem = await SystemItem.findById(id);

    if (!existingSystemItem) {
      return res.status(404).json({
        success: false,
        message: "System Item not found",
      });
    }

    const isUsedBoolean = isUsed === "true";

    if (existingSystemItem.isUsed === isUsedBoolean) {
      return res.status(400).json({
        success: false,
        message: `System Item is already marked as - ${isUsedBoolean ? "Used" : "Not Used"}`,
      });
    }

    // ✅ Correct Mongoose update
    const updatedSystemItem = await SystemItem.findByIdAndUpdate(
      id,
      {
        isUsed: isUsedBoolean,
        updatedByEmpId: empId,
        updatedAt: new Date(),
      },
      { new: true },
    );

    await prisma.auditLog.create({
      data: {
        entityType: "SystemItem",
        entityId: id,
        action: "STATUS_UPDATED",
        performedBy: empId || null,
        oldValue: { isUsed: existingSystemItem.isUsed },
        newValue: { isUsed: updatedSystemItem.isUsed },
      },
    });

    return res.status(200).json({
      success: true,
      message: `System Item marked as - ${isUsedBoolean ? "Used." : "Not Used."}`,
      data: updatedSystemItem,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getPendingPOsForReceiving = async (req, res) => {
  try {
    const warehouseId = req.user.warehouseId;

    // 1️⃣ Fetch POs with all items
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        warehouseId,
        status: {
          notIn: ["Cancelled", "Received", "Admin_Rejected"],
        },
      },
      include: {
        items: true,
      },
      orderBy: {
        poDate: "desc",
      },
    });

    // 2️⃣ Filter POs + Items in JS
    const pendingPOs = pos
      .map((po) => {
        // keep ONLY pending items
        const pendingItems = po.items.filter((item) => {
          const orderedQty = Number(item.quantity || 0);
          const receivedQty = Number(item.receivedQty || 0);
          return receivedQty < orderedQty;
        });

        // ❌ if no pending items, drop the PO
        if (pendingItems.length === 0) return null;

        // ✅ return PO with ONLY pending items
        return {
          id: po.id,
          poNumber: po.poNumber,
          companyId: po.companyId,
          companyName: po.companyName,
          vendorId: po.vendorId,
          vendorName: po.vendorName,
          warehouseId: po.warehouseId,
          warehouseName: po.warehouseName,
          poDate: po.poDate,
          expectedDeliveryDate: po.expectedDeliveryDate,
          status: po.status,
          approvalStatus: po.approvalStatus,
          items: pendingItems.map((item) => ({
            id: item.id,
            itemId: item.itemId,
            itemSource: item.itemSource,
            itemName: item.itemName,
            hsnCode: item.hsnCode,
            modelNumber: item.modelNumber,
            unit: item.unit,
            quantity: item.quantity,
            receivedQty: item.receivedQty,
            pendingQty:
              Number(item.quantity || 0) - Number(item.receivedQty || 0),
            itemDetail: item.itemDetail
          })),
        };
      })
      .filter(Boolean); // remove null POs

    return res.json({
      success: true,
      message: "Pending POs for receiving fetched successfully.",
      data: pendingPOs,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const purchaseOrderReceivingBill = async (req, res) => {
  const userId = req.user?.id;
  const warehouseId = String(req.user?.warehouseId);
  let uploadedFilePath = null;

  const deleteUploadedFile = async () => {
    if (uploadedFilePath) {
      try {
        await fs.unlink(uploadedFilePath);
      } catch (err) {
        console.error("⚠️ Failed to delete uploaded file:", err);
      }
    }
  };

  const validateItems = async (items, po) => {
    for (const item of items) {
      console.log(item);
      const { itemId, itemSource, purchaseOrderItemId } = item;

      if (!itemId || !itemSource || !purchaseOrderItemId) {
        throw new Error("Invalid item data.");
      }
      console.log(purchaseOrderItemId, itemId, itemSource);
      const poItem = po.items.find((p) => p.id === purchaseOrderItemId);
      if (!poItem) {
        throw new Error(`PO item not found.`);
      }

      if (itemSource === "mongo") {
        const systemItem = await SystemItem.findById(itemId);
        if (!systemItem) throw new Error(`SystemItem not found.`);
      } else if (itemSource === "mysql") {
        const rawMat = await prisma.rawMaterial.findUnique({
          where: { id: itemId },
        });
        if (!rawMat) throw new Error(`RawMaterial not found.`);
      } else {
        throw new Error(`Invalid itemSource.`);
      }
    }
  };

  try {
    // ================= PARSE ITEMS =================
    if (req.body.items) {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid items JSON." });
      }
    }

    const { purchaseOrderId, items, invoiceNumber, vehicleNumber } = req.body;
    const billFile = req.files?.billFile?.[0];

    if (!billFile)
      return res
        .status(400)
        .json({ success: false, message: "Bill file is required." });
    uploadedFilePath = path.join(
      __dirname,
      "../../uploads/purchaseOrder/receivingBill",
      billFile.filename,
    );

    if (
      !purchaseOrderId ||
      !invoiceNumber ||
      !Array.isArray(items) ||
      !items.length
    ) {
      await deleteUploadedFile();
      return res.status(400).json({
        success: false,
        message: "purchaseOrderId, invoiceNumber and items are required.",
      });
    }

    // ================= FETCH PO =================
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });

    if (!po) throw new Error("Purchase Order not found.");

    if (po.warehouseName === "Bhiwani" || po.warehouseName === 'Malanpur Warehouse') {
      if (!vehicleNumber) {
        return res.status(400).json({
          success: false,
          message: "vehicleNo is required for Bhiwani warehouse"
        });
      }
    }

    // if (po.approvalStatus !== "Approved") {
    //   throw new Error("Cannot receive items as PO not approved by admin.")
    // }

    // if (po.approvalStatus === 'Rejected') {
    //   throw new Error("Cannot receive items as PO is rejected by admin");
    // }

    if (["Cancelled", "Received"].includes(po.status))
      throw new Error(`PO already ${po.status}.`);

    if (String(po.warehouseId) !== warehouseId)
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized warehouse access." });

    await validateItems(items, po);
    // ================= PRISMA + MONGO ATOMIC =================
    const { receiptResults, stockUpdates } = await prisma.$transaction(
      async (tx) => {
        const receiptResults = [];
        const stockUpdates = [];
        const mongoRollbackStack = [];

        // Save bill
        await tx.purchaseOrderBill.create({
          data: {
            purchaseOrderId,
            invoiceNumber,
            vehicleNumber: vehicleNumber || null,
            fileName: billFile.filename,
            fileUrl: `/uploads/purchaseOrder/receivingBill/${billFile.filename}`,
            mimeType: billFile.mimetype,
            uploadedBy: userId,
          },
        });

        for (const item of items) {
          const {
            purchaseOrderItemId,
            itemId,
            itemSource,
            itemName,
            goodQty = 0,
            damagedQty = 0,
            remarks = "",
          } = item;
          const poItem = po.items.find((p) => p.id === purchaseOrderItemId);
          if (!poItem) throw new Error(`PO item ${itemName} not found.`);

          const orderedQty = Number(poItem.quantity || 0);
          const alreadyReceived = Number(poItem.receivedQty || 0);
          const poUnit = poItem.unit?.toLowerCase();

          if (alreadyReceived + goodQty > orderedQty)
            throw new Error(`Over receiving ${itemName}`);
          const totalReceived = alreadyReceived + goodQty;

          // Receipt entry
          await tx.purchaseOrderReceipt.create({
            data: {
              purchaseOrderId,
              purchaseOrderItemId,
              invoiceNumber,
              vehicleNumber: vehicleNumber || null,
              itemId,
              itemSource,
              itemName,
              receivedQty: goodQty + damagedQty,
              goodQty,
              damagedQty,
              remarks,
              createdBy: userId,
              receivedDate: new Date(),
            },
          });

          // Update PO Item receivedQty
          await tx.purchaseOrderItem.update({
            where: { id: purchaseOrderItemId },
            data: { receivedQty: totalReceived },
          });

          // Damaged stock
          if (damagedQty > 0) {
            await tx.damagedStock.create({
              data: {
                purchaseOrderId,
                invoiceNumber,
                itemId,
                itemSource,
                itemName,
                unit: poItem.unit,
                quantity: damagedQty,
                status: "Pending",
                remarks,
                createdBy: userId,
              },
            });
          }

          // Stock updates
          if (goodQty > 0)
            stockUpdates.push({
              itemSource,
              itemId,
              goodQty,
              poUnit,
              warehouseId,
            });
          receiptResults.push({
            itemId,
            itemName,
            goodQty,
            damagedQty,
            remainingQty: orderedQty - totalReceived,
          });
        }

        // PO status update
        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId },
          select: { quantity: true, receivedQty: true },
        });
        const allReceived = updatedItems.every(
          (i) => Number(i.receivedQty || 0) >= Number(i.quantity || 0),
        );
        const anyReceived = updatedItems.some(
          (i) => Number(i.receivedQty || 0) > 0,
        );

        let newStatus = po.status;
        if (allReceived) newStatus = "Received";
        else if (anyReceived) newStatus = "PartiallyReceived";

        if (newStatus !== po.status)
          await tx.purchaseOrder.update({
            where: { id: purchaseOrderId },
            data: { status: newStatus },
          });

        // MySQL stock update
        for (const s of stockUpdates.filter((s) => s.itemSource === "mysql")) {
          const rawMat = await tx.rawMaterial.findUnique({
            where: { id: s.itemId },
          });
          if (!rawMat)
            throw new Error(`Raw material not found for ${s.itemName}`);

          const baseUnit = rawMat.unit?.toLowerCase();
          const convUnit = rawMat.conversionUnit?.toLowerCase();
          const factor = Number(rawMat.conversionFactor || 1);

          let convertedQty = s.goodQty;
          if (baseUnit && s.poUnit !== baseUnit) {
            if (convUnit && s.poUnit === convUnit)
              convertedQty = s.goodQty / factor;
            else
              throw new Error(`Invalid unit for raw material ${rawMat.name}`);
          }

          await tx.warehouseStock.upsert({
            where: {
              warehouseId_rawMaterialId: {
                warehouseId: s.warehouseId,
                rawMaterialId: s.itemId,
              },
            },
            update: { quantity: { increment: convertedQty } },
            create: {
              warehouseId: s.warehouseId,
              rawMaterialId: s.itemId,
              quantity: convertedQty,
              unit: baseUnit,
            },
          });
        }

        // ================= MONGO STOCK =================
        try {
          for (const s of stockUpdates.filter(
            (s) => s.itemSource === "mongo",
          )) {
            const systemItem = await SystemItem.findById(s.itemId);
            if (!systemItem)
              throw new Error(`System item ${s.itemName} not found`);
            console.log(systemItem);
            const baseUnit = systemItem.unit?.toLowerCase().trim();
            console.log("System Item Unit: ", baseUnit);
            const convUnit = (
              systemItem.conversionUnit ??
              systemItem.converionUnit ??
              ""
            )
              ?.toLowerCase()
              .trim();
            console.log("System Item Con Unit: ", convUnit);
            const factor = Number(systemItem.conversionFactor || 1);
            console.log("System Item Conv Factor: ", factor);

            console.log({
              poUnit: s.poUnit?.toLowerCase().trim(),
              baseUnit,
              convUnit,
            });
            let convertedQty = s.goodQty;
            if (baseUnit && s.poUnit !== baseUnit) {
              if (convUnit && s.poUnit === convUnit)
                convertedQty = s.goodQty / factor;
              else
                throw new Error(
                  `Invalid unit for system item ${systemItem.itemName}`,
                );
            }

            const inv = await InstallationInventory.findOne({
              warehouseId: s.warehouseId,
              systemItemId: s.itemId,
            });
            if (inv) {
              mongoRollbackStack.push({
                type: "update",
                id: inv._id,
                oldQty: inv.quantity,
              });
              console.log("Previous", inv);
              inv.quantity += convertedQty;
              inv.updatedAt = new Date();
              inv.updatedByEmpId = req.user?.id;
              await inv.save();
              console.log("After", inv);
            } else {
              const created = await InstallationInventory.create({
                warehouseId: s.warehouseId,
                systemItemId: s.itemId,
                quantity: convertedQty,
              });
              mongoRollbackStack.push({ type: "create", id: created._id });
            }
          }
        } catch (mongoErr) {
          // Rollback Mongo + throw to rollback MySQL via transaction
          for (const r of mongoRollbackStack.reverse()) {
            if (r.type === "update")
              await InstallationInventory.findByIdAndUpdate(r.id, {
                quantity: r.oldQty,
              });
            if (r.type === "create")
              await InstallationInventory.findByIdAndDelete(r.id);
          }
          throw mongoErr;
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            entityType: "PurchaseOrder",
            entityId: purchaseOrderId,
            action: "RECEIVE_PO",
            performedBy: userId,
            oldValue: po,
            newValue: { receiptResults },
          },
        });

        return { receiptResults, stockUpdates };
      },
    );

    return res.status(200).json({
      success: true,
      message: "Purchase Order received successfully.",
      data: receiptResults,
    });
  } catch (err) {
    console.error("❌ PO Receiving Error:", err);
    await deleteUploadedFile();
    return res
      .status(500)
      .json({ success: false, message: err.message || "PO receiving failed." });
  }
};

const purchaseOrderReceivingBill2 = async (req, res) => {
  const userId = req.user?.id;
  const warehouseId = String(req.user?.warehouseId);
  let uploadedFilePath = null;

  const deleteUploadedFile = async () => {
    if (uploadedFilePath) {
      try {
        await fs.unlink(uploadedFilePath);
      } catch (err) {
        console.error("⚠️ Failed to delete uploaded file:", err);
      }
    }
  };

  const validateItems = async (items, po) => {
    for (const item of items) {
      const { itemId, itemSource, purchaseOrderItemId } = item;

      if (!itemId || !itemSource || !purchaseOrderItemId) {
        throw new Error("Invalid item data.");
      }

      const poItem = po.items.find((p) => p.id === purchaseOrderItemId);
      if (!poItem) {
        throw new Error(`PO item ${purchaseOrderItemId} not found.`);
      }

      if (itemSource === "mongo") {
        const systemItem = await SystemItem.findById(itemId);
        if (!systemItem) throw new Error(`SystemItem ${itemId} not found.`);
      } else if (itemSource === "mysql") {
        const rawMat = await prisma.rawMaterial.findUnique({
          where: { id: itemId },
        });
        if (!rawMat) throw new Error(`RawMaterial ${itemId} not found.`);
      } else {
        throw new Error(`Invalid itemSource for ${itemId}.`);
      }
    }
  };

  try {
    // ================= PARSE ITEMS =================
    if (req.body.items) {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid items JSON." });
      }
    }

    const { purchaseOrderId, items, invoiceNumber, vehicleNumber } = req.body;
    const billFile = req.files?.billFile?.[0];

    if (!billFile)
      return res
        .status(400)
        .json({ success: false, message: "Bill file is required." });
    uploadedFilePath = path.join(
      __dirname,
      "../../uploads/purchaseOrder/receivingBill",
      billFile.filename,
    );

    if (
      !purchaseOrderId ||
      !invoiceNumber ||
      !vehicleNumber ||
      !Array.isArray(items) ||
      !items.length
    ) {
      await deleteUploadedFile();
      return res.status(400).json({
        success: false,
        message: "purchaseOrderId, invoiceNumber, vehicleNumber & items are required.",
      });
    }

    // ================= FETCH PO =================
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });

    if (!po) throw new Error("Purchase Order not found.");

    if (["Cancelled", "Received"].includes(po.status))
      throw new Error(`PO already ${po.status}.`);

    if (String(po.warehouseId) !== warehouseId)
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized warehouse access." });

    await validateItems(items, po);
    // ================= PRISMA + MONGO ATOMIC =================
    const { receiptResults, stockUpdates } = await prisma.$transaction(
      async (tx) => {
        const receiptResults = [];
        const stockUpdates = [];
        const mongoRollbackStack = [];

        // Save bill
        await tx.purchaseOrderBill.create({
          data: {
            purchaseOrderId,
            invoiceNumber,
            vehicleNumber,
            fileName: billFile.filename,
            fileUrl: `/uploads/purchaseOrder/receivingBill/${billFile.filename}`,
            mimeType: billFile.mimetype,
            uploadedBy: userId,
          },
        });

        for (const item of items) {
          const {
            purchaseOrderItemId,
            itemId,
            itemSource,
            itemName,
            goodQty = 0,
            damagedQty = 0,
            remarks = "",
          } = item;
          const poItem = po.items.find((p) => p.id === purchaseOrderItemId);
          if (!poItem) throw new Error(`PO item ${itemName} not found.`);

          const orderedQty = Number(poItem.quantity || 0);
          const alreadyReceived = Number(poItem.receivedQty || 0);
          const poUnit = poItem.unit?.toLowerCase();

          if (alreadyReceived + goodQty > orderedQty)
            throw new Error(`Over receiving ${itemName}`);
          const totalReceived = alreadyReceived + goodQty;

          // Receipt entry
          await tx.purchaseOrderReceipt.create({
            data: {
              purchaseOrderId,
              purchaseOrderItemId,
              invoiceNumber,
              vehicleNumber,
              itemId,
              itemSource,
              itemName,
              receivedQty: goodQty + damagedQty,
              goodQty,
              damagedQty,
              remarks,
              createdBy: userId,
              receivedDate: new Date(),
            },
          });

          // Update PO Item receivedQty
          await tx.purchaseOrderItem.update({
            where: { id: purchaseOrderItemId },
            data: { receivedQty: totalReceived },
          });

          // Damaged stock
          if (damagedQty > 0) {
            await tx.damagedStock.create({
              data: {
                purchaseOrderId,
                invoiceNumber,
                itemId,
                itemSource,
                itemName,
                unit: poItem.unit,
                quantity: damagedQty,
                status: "Pending",
                remarks,
                createdBy: userId,
              },
            });
          }

          // Stock updates
          if (goodQty > 0)
            stockUpdates.push({
              itemSource,
              itemId,
              goodQty,
              poUnit,
              warehouseId,
            });
          receiptResults.push({
            itemId,
            itemName,
            goodQty,
            damagedQty,
            remainingQty: orderedQty - totalReceived,
          });
        }

        // PO status update
        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId },
          select: { quantity: true, receivedQty: true },
        });
        const allReceived = updatedItems.every(
          (i) => Number(i.receivedQty || 0) >= Number(i.quantity || 0),
        );
        const anyReceived = updatedItems.some(
          (i) => Number(i.receivedQty || 0) > 0,
        );

        let newStatus = po.status;
        if (allReceived) newStatus = "Received";
        else if (anyReceived) newStatus = "PartiallyReceived";

        if (newStatus !== po.status)
          await tx.purchaseOrder.update({
            where: { id: purchaseOrderId },
            data: { status: newStatus },
          });

        // MySQL stock update
        for (const s of stockUpdates.filter((s) => s.itemSource === "mysql")) {
          const rawMat = await tx.rawMaterial.findUnique({
            where: { id: s.itemId },
          });
          if (!rawMat)
            throw new Error(`Raw material not found for ${s.itemId}`);

          const baseUnit = rawMat.unit?.toLowerCase();
          const convUnit = rawMat.conversionUnit?.toLowerCase();
          const factor = Number(rawMat.conversionFactor || 1);

          let convertedQty = s.goodQty;
          if (baseUnit && s.poUnit !== baseUnit) {
            if (convUnit && s.poUnit === convUnit)
              convertedQty = s.goodQty * factor;
            else
              throw new Error(`Invalid unit for raw material ${rawMat.name}`);
          }

          await tx.warehouseStock.upsert({
            where: {
              warehouseId_rawMaterialId: {
                warehouseId: s.warehouseId,
                rawMaterialId: s.itemId,
              },
            },
            update: { quantity: { increment: convertedQty } },
            create: {
              warehouseId: s.warehouseId,
              rawMaterialId: s.itemId,
              quantity: convertedQty,
              unit: baseUnit,
            },
          });
        }

        // ================= MONGO STOCK =================
        try {
          for (const s of stockUpdates.filter(
            (s) => s.itemSource === "mongo",
          )) {
            const systemItem = await SystemItem.findById(s.itemId);
            if (!systemItem)
              throw new Error(`System item ${s.itemId} not found`);

            const baseUnit = systemItem.unit?.toLowerCase();
            const convUnit = systemItem.conversionUnit?.toLowerCase();
            const factor = Number(systemItem.conversionFactor || 1);

            let convertedQty = s.goodQty;
            if (baseUnit && s.poUnit !== baseUnit) {
              if (convUnit && s.poUnit === convUnit)
                convertedQty = s.goodQty * factor;
              else
                throw new Error(
                  `Invalid unit for system item ${systemItem._id}`,
                );
            }

            const inv = await InstallationInventory.findOne({
              warehouseId: s.warehouseId,
              systemItemId: s.itemId,
            });
            if (inv) {
              mongoRollbackStack.push({
                type: "update",
                id: inv._id,
                oldQty: inv.quantity,
              });
              console.log("Previous", inv);
              inv.quantity += convertedQty;
              inv.updatedAt = new Date();
              inv.updatedByEmpId = req.user?.id;
              await inv.save();
              console.log("After", inv);
            } else {
              const created = await InstallationInventory.create({
                warehouseId: s.warehouseId,
                systemItemId: s.itemId,
                quantity: convertedQty,
              });
              mongoRollbackStack.push({ type: "create", id: created._id });
            }
          }
        } catch (mongoErr) {
          // Rollback Mongo + throw to rollback MySQL via transaction
          for (const r of mongoRollbackStack.reverse()) {
            if (r.type === "update")
              await InstallationInventory.findByIdAndUpdate(r.id, {
                quantity: r.oldQty,
              });
            if (r.type === "create")
              await InstallationInventory.findByIdAndDelete(r.id);
          }
          throw mongoErr;
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            entityType: "PurchaseOrder",
            entityId: purchaseOrderId,
            action: "RECEIVE_PO",
            performedBy: userId,
            oldValue: po,
            newValue: { receiptResults },
          },
        });

        return { receiptResults, stockUpdates };
      },
    );

    return res.status(200).json({
      success: true,
      message: "Purchase Order received successfully.",
      data: receiptResults,
    });
  } catch (err) {
    console.error("❌ PO Receiving Error:", err);
    await deleteUploadedFile();
    return res
      .status(500)
      .json({ success: false, message: err.message || "PO receiving failed." });
  }
};

const directItemIssue = async (req, res) => {
  try {
    const issuedBy = req.user?.id;
    const userWarehouseId = req.user?.warehouseId;

    /* ---------------- AUTH VALIDATION ---------------- */
    if (!issuedBy) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (!userWarehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to storekeeper",
      });
    }

    const {
      issuedTo,
      rawMaterialIssued,
      remarks,
      serviceProcessId,
      issuedToName,
      department,
    } = req.body;

    /* ---------------- BODY VALIDATION ---------------- */
    if (!issuedTo) {
      return res.status(400).json({
        success: false,
        message: "issuedTo (employee id) is required",
      });
    }

    const issuedToUser = await prisma.user.findUnique({
      where: {
        id: issuedTo,
      },
      select: {
        name: true,
        role: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!issuedToUser) {
      return res.status(404).json({
        success: false,
        message: "IssuedTo User Not Found.",
      });
    }

    const userRole = issuedToUser.role?.name;
    if (userRole === "Others") {
      if (!issuedToName || !department) {
        return res.status(400).json({
          success: false,
          message: `selected ${issuedToUser.name}: issuedToName and department is required.`,
        });
      }
    }

    if (!Array.isArray(rawMaterialIssued) || rawMaterialIssued.length === 0) {
      return res.status(400).json({
        success: false,
        message: "rawMaterialIssued must be a non-empty array",
      });
    }

    /* ---------------- NORMALIZE MATERIALS ---------------- */
    const materialMap = new Map();

    for (let i = 0; i < rawMaterialIssued.length; i++) {
      const item = rawMaterialIssued[i];
      const quantity = Number(item.quantity);

      if (!item.rawMaterialId) {
        return res.status(400).json({
          success: false,
          message: `rawMaterialId missing at index ${i}`,
        });
      }

      if (!item.quantity || isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for rawMaterialId ${item.rawMaterialId}`,
        });
      }

      // Merge duplicate rawMaterialIds
      materialMap.set(
        item.rawMaterialId,
        (materialMap.get(item.rawMaterialId) || 0) + quantity,
      );
    }

    /* ---------------- TRANSACTION ---------------- */
    const result = await prisma.$transaction(async (tx) => {
      // 🔹 Process each material
      for (const [rawMaterialId, quantity] of materialMap.entries()) {
        const warehouseStock = await tx.warehouseStock.findUnique({
          where: {
            warehouseId_rawMaterialId: {
              warehouseId: userWarehouseId,
              rawMaterialId,
            },
          },
        });

        if (!warehouseStock) {
          throw new Error(
            `Stock not found in warehouse for rawMaterialId ${rawMaterialId}`,
          );
        }

        if (warehouseStock.quantity < quantity) {
          throw new Error(
            `Insufficient stock for rawMaterialId ${rawMaterialId}. Available: ${warehouseStock.quantity}, Required: ${quantity}`,
          );
        }

        // 🔻 Reduce warehouse stock
        await tx.warehouseStock.update({
          where: {
            warehouseId_rawMaterialId: {
              warehouseId: userWarehouseId,
              rawMaterialId,
            },
          },
          data: {
            quantity: { decrement: quantity },
          },
        });

        // ➕ Add to user stock (empId!)
        await tx.userItemStock.upsert({
          where: {
            empId_rawMaterialId: {
              empId: issuedTo,
              rawMaterialId,
            },
          },
          update: {
            quantity: { increment: quantity },
          },
          create: {
            empId: issuedTo,
            rawMaterialId,
            quantity,
            unit: warehouseStock.unit,
          },
        });
      }

      // 🔹 Create Direct Issue record
      const directIssue = await tx.directItemIssue.create({
        data: {
          warehouseId: userWarehouseId,
          serviceProcessId,
          isProcessIssue: Boolean(serviceProcessId),
          rawMaterialIssued,
          issuedTo,
          issuedBy,
          issuedToName: issuedToName || issuedToUser.name || null,
          department: department || issuedToUser.role?.name || null,
          remarks,
        },
      });

      return directIssue;
    });

    return res.status(200).json({
      success: true,
      message: "Items issued successfully",
      data: result,
    });
  } catch (error) {
    console.error("Direct Item Issue Error:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Failed to issue items",
    });
  }
};

// ---------------------------------

const newDirectItemIssue = async (req, res) => {
  try {
    const issuedBy = req.user?.id;
    const userWarehouseId = req.user?.warehouseId;

    /* ---------------- AUTH VALIDATION ---------------- */
    if (!issuedBy) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (!userWarehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to storekeeper",
      });
    }

    const {
      issuedTo,
      rawMaterialIssued,
      remarks,
      serviceProcessId,
      issuedToName,
      department,
    } = req.body;

    /* ---------------- BODY VALIDATION ---------------- */
    if (!issuedTo) {
      return res.status(400).json({
        success: false,
        message: "issuedTo (employee id) is required",
      });
    }

    const issuedToUser = await prisma.user.findUnique({
      where: {
        id: issuedTo,
      },
      select: {
        name: true,
        role: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!issuedToUser) {
      return res.status(404).json({
        success: false,
        message: "IssuedTo User Not Found.",
      });
    }

    const userRole = issuedToUser.role?.name;
    if (userRole === "Others") {
      if (!issuedToName || !department) {
        return res.status(400).json({
          success: false,
          message: `selected ${issuedToUser.name}: issuedToName and department is required.`,
        });
      }
    }

    if (!Array.isArray(rawMaterialIssued) || rawMaterialIssued.length === 0) {
      return res.status(400).json({
        success: false,
        message: "rawMaterialIssued must be a non-empty array",
      });
    }

    /* ---------------- NORMALIZE MATERIALS ---------------- */
    const materialMap = new Map();

    for (let i = 0; i < rawMaterialIssued.length; i++) {
      const item = rawMaterialIssued[i];
      const quantity = Number(item.quantity);

      if (!item.rawMaterialId) {
        return res.status(400).json({
          success: false,
          message: `rawMaterialId missing at index ${i}`,
        });
      }

      if (!item.quantity || isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for rawMaterialId ${item.rawMaterialId}`,
        });
      }

      // Merge duplicate rawMaterialIds
      materialMap.set(
        item.rawMaterialId,
        (materialMap.get(item.rawMaterialId) || 0) + quantity,
      );
    }

    let mySqlRawMaterial = [];
    let mongoRawMaterial = [];

    rawMaterialIssued.forEach((item) => {
      if (mongoose.Types.ObjectId.isValid(item.rawMaterialId)) {
        mongoRawMaterial.push(item.rawMaterialId)
      }
      else {
        mySqlRawMaterial.push(item.rawMaterialId);
      }
    })


    if (mySqlRawMaterial.length === 0 && mongoRawMaterial.length === 0) return res.status(400).json({ success: false, message: "Raw Material not provided." });

    let mongoUpdates = []
    let result = await prisma.$transaction(async (tx) => {

      for (let [rawMaterialId, quantity] of materialMap.entries()) {

        if (mongoRawMaterial.includes(rawMaterialId)) {
          const system = await SystemItem.findOne({ _id: rawMaterialId });

          if (!system) throw new Error(`Raw Material Not found for ${rawMaterialId}`);

          let inventory = await InstallationInventory.findOne({
            warehouseId: userWarehouseId,
            systemItemId: rawMaterialId
          })
          if (!inventory) throw new Error(`Inventory Not found for ${rawMaterialId}`)

          if (inventory.quantity < quantity) throw new Error(`Insufficient inventory stock for ${rawMaterialId}.`)

          mongoUpdates.push({ rawMaterialId, quantity })
        }

        if (mySqlRawMaterial.includes(rawMaterialId)) {
          const warehouseStock = await tx.warehouseStock.findUnique({
            where: {
              warehouseId_rawMaterialId: {
                warehouseId: userWarehouseId,
                rawMaterialId,
              },
            },
          });

          if (!warehouseStock) {
            throw new Error(
              `Stock not found in warehouse for rawMaterialId ${rawMaterialId}`,
            );
          }

          if (warehouseStock.quantity < quantity) {
            throw new Error(
              `Insufficient stock for rawMaterialId ${rawMaterialId}. Available: ${warehouseStock.quantity}, Required: ${quantity}`,
            );
          }

          // 🔻 Reduce warehouse stock
          await tx.warehouseStock.update({
            where: {
              warehouseId_rawMaterialId: {
                warehouseId: userWarehouseId,
                rawMaterialId,
              },
            },
            data: {
              quantity: { decrement: quantity },
            },
          });

          // ➕ Add to user stock (empId!)
          await tx.userItemStock.upsert({
            where: {
              empId_rawMaterialId: {
                empId: issuedTo,
                rawMaterialId,
              },
            },
            update: {
              quantity: { increment: quantity },
            },
            create: {
              empId: issuedTo,
              rawMaterialId,
              quantity,
              unit: warehouseStock.unit,
            },
          });

        }

      }
      return await tx.directItemIssue.create({
        data: {
          warehouseId: userWarehouseId,
          serviceProcessId,
          isProcessIssue: Boolean(serviceProcessId),
          rawMaterialIssued,
          issuedTo,
          issuedBy,
          issuedToName: issuedToName || issuedToUser.name || null,
          department: department || issuedToUser.role?.name || null,
          remarks,
        },
      });
    })

    for (const item of mongoUpdates) {
      await InstallationInventory.updateOne(
        {
          warehouseId: userWarehouseId,
          systemItemId: item.rawMaterialId,
        },
        {
          $inc: {
            quantity: -item.quantity,
          },
        }
      );
    }



    return res.status(200).json({
      success: true,
      message: "Items issued successfully",
      data: result,
    });
  } catch (er) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
}

// ---------------------------------

const getDirectItemIssueHistory = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    // Fetch warehouse details
    const warehouse =
      await Warehouse.findById(warehouseId).select("_id warehouseName");

    // Fetch DirectItemIssue history
    const history = await prisma.directItemIssue.findMany({
      where: { warehouseId },
      include: {
        issuedToUser: { select: { id: true, name: true } },
        issuedByUser: { select: { id: true, name: true } },
      },
      orderBy: { issuedAt: "desc" },
    });

    if (!history.length) {
      return res.json({ success: true, data: [] });
    }

    // Collect all rawMaterialIds
    const rawMaterialIds = [
      ...new Set(
        history.flatMap((issue) =>
          Array.isArray(issue.rawMaterialIssued)
            ? issue.rawMaterialIssued.map((item) => item.rawMaterialId)
            : [],
        ),
      ),
    ];

    // Fetch rawMaterial names
    const rawMaterials = rawMaterialIds.length
      ? await prisma.rawMaterial.findMany({
        where: { id: { in: rawMaterialIds } },
        select: { id: true, name: true },
      })
      : [];

    const rawMaterialMap = {};
    rawMaterials.forEach((rm) => {
      rawMaterialMap[rm.id] = rm.name;
    });

    // Build clean, simple response
    const response = history.map((issue) => ({
      id: issue.id,
      // warehouseId: warehouse?._id || null,
      // warehouseName: warehouse?.warehouseName || null,
      issuedById: issue.issuedByUser?.id || null,
      issuedByName: issue.issuedByUser?.name || null,
      issuedToId: issue.issuedToUser?.id || null,
      issuedToName: issue.issuedToName || issue.issuedToUser?.name || null,
      rawMaterialIssued: Array.isArray(issue.rawMaterialIssued)
        ? issue.rawMaterialIssued.map((item) => ({
          rawMaterialId: item.rawMaterialId,
          rawMaterialName: rawMaterialMap[item.rawMaterialId] || null,
          quantity: item.quantity,
          unit: item.unit,
        }))
        : [],
      issuedAt: issue.issuedAt,
      remarks: issue.remarks,
    }));

    res.json({
      success: true,
      message: "Direct item issue history fetched successfully.",
      data: response || [],
    });
  } catch (error) {
    console.error("Direct Issue History Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch direct issue history",
    });
  }
};

const getLineWorkerList2 = async (req, res) => {
  try {
    const empId = req.user?.id;
    const userWarehouseId = req.user?.warehouseId;
    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "EmpId Not Found",
      });
    }

    const empData = await prisma.user.findFirst({
      where: {
        id: empId,
      },
      include: {
        role: true,
      },
    });

    if (empData?.role?.name !== "Store") {
      return res.status(400).json({
        success: false,
        message: "Only Store Keeper Have Access To The Line-Workers",
      });
    }

    const userData = await prisma.user.findMany({
      where: {
        warehouseId: userWarehouseId,
        role: {
          is: {
            name: {
              notIn: ["Admin", "SuperAdmin", "Store", "Purchase"],
            },
          },
        },
      },
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        role: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      data: userData || [],
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

const getRawMaterialList2 = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    const allRawMaterial = await prisma.rawMaterial.findMany({
      select: {
        id: true,
        name: true,
        unit: true,
        warehouseStock: {
          where: {
            warehouseId,
          },
          select: {
            quantity: true,
            isUsed: true,
          },
        },
      },
    });

    const formattedData = allRawMaterial.map((data) => {
      const warehouseData = data.warehouseStock[0] || {};

      const stock = warehouseData.quantity ?? 0;
      const isUsed = warehouseData.isUsed ?? false;

      return {
        id: data.id,
        name: data.name,
        stock: formatStock(stock),
        rawStock: stock, // only for sorting
        unit: data.unit,
        isUsed,
        outOfStock: stock === 0,
      };
    });

    const sortedData = formattedData.sort((a, b) => {
      if (a.isUsed === b.isUsed) {
        return a.rawStock - b.rawStock;
      }
      return a.isUsed ? -1 : 1;
    });

    const cleanedData = sortedData.map(({ rawStock, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      message: "Raw material fetched successfully",
      data: cleanedData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const sanctionItemForRequest2 = async (req, res) => {
  try {
    const { itemRequestId } = req.body;
    const warehouseId = req.user?.warehouseId;

    if (!itemRequestId) {
      return res.status(400).json({
        success: false,
        message: "ItemRequestId Not Found",
      });
    }

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    const itemRequestData = await prisma.itemRequestData.findFirst({
      where: { id: itemRequestId },
    });

    if (!itemRequestData) throw new Error("Item request not found");
    if (itemRequestData.approved === null)
      throw new Error("Item request is not approved.");
    if (itemRequestData.declined === true)
      throw new Error("Item request is declined.");
    if (itemRequestData.materialGiven)
      throw new Error("Material already sanctioned");

    const rawMaterials = itemRequestData.rawMaterialRequested;
    if (!Array.isArray(rawMaterials) || rawMaterials.length === 0) {
      throw new Error("No raw material data found in the request");
    }

    const date = new Date();

    const result = await prisma.$transaction(async (tx) => {
      for (const rawMaterial of rawMaterials) {
        // 1️⃣ Validate raw material master
        const rawMaterialData = await tx.rawMaterial.findFirst({
          where: { id: rawMaterial.rawMaterialId },
        });

        if (!rawMaterialData) {
          throw new Error(
            `Raw material not found for ID: ${rawMaterial.rawMaterialId}`,
          );
        }

        // 2️⃣ Get warehouse stock
        const warehouseStock = await tx.warehouseStock.findFirst({
          where: {
            warehouseId,
            rawMaterialId: rawMaterial.rawMaterialId,
          },
        });

        if (!warehouseStock) {
          throw new Error(
            `Stock not available in warehouse for ${rawMaterialData.name}`,
          );
        }

        if (Number(warehouseStock.quantity) < Number(rawMaterial.quantity)) {
          throw new Error(
            `Can't sanction! Requested quantity for ${rawMaterialData.name} exceeds warehouse stock`,
          );
        }

        // 3️⃣ Decrease warehouse stock
        await tx.warehouseStock.update({
          where: { id: warehouseStock.id },
          data: {
            quantity: {
              decrement: Number(rawMaterial.quantity),
            },
          },
        });

        // 4️⃣ Credit user stock
        const existingUserItemStock = await tx.userItemStock.findFirst({
          where: {
            empId: itemRequestData.requestedBy,
            rawMaterialId: rawMaterial.rawMaterialId,
          },
        });

        if (existingUserItemStock) {
          await tx.userItemStock.update({
            where: { id: existingUserItemStock.id },
            data: {
              quantity: {
                increment: Number(rawMaterial.quantity),
              },
            },
          });
        } else {
          await tx.userItemStock.create({
            data: {
              empId: itemRequestData.requestedBy,
              rawMaterialId: rawMaterial.rawMaterialId,
              quantity: Number(rawMaterial.quantity),
              unit: rawMaterial.unit,
            },
          });
        }
      }

      // 5️⃣ Mark request as sanctioned
      return tx.itemRequestData.update({
        where: { id: itemRequestId },
        data: {
          materialGiven: true,
          updatedAt: date,
          updatedBy: req.user.id,
        },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Material sanctioned from warehouse successfully",
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

const showProcessData2 = async (req, res) => {
  try {
    const {
      filterType,
      startDate,
      endDate,
      status,
      stageId,
      itemTypeId,
      search,
      page = 1,
      limit = 15,
    } = req.query;

    const warehouseId = req.user?.warehouseId;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    let filterConditions = { AND: [] };

    // ---------- UTIL ----------
    const ISTtoUTC = (date) => new Date(date.getTime() - 5.5 * 60 * 60 * 1000);

    const now = new Date();
    const todayIST = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // ---------- DATE FILTER ----------
    const setDateFilter = () => {
      let startIST, endIST;

      switch (filterType) {
        case "Today":
          startIST = todayIST;
          endIST = new Date(todayIST);
          endIST.setHours(23, 59, 59, 999);
          break;

        case "Week":
          startIST = new Date(todayIST);
          startIST.setDate(todayIST.getDate() - 6);
          endIST = now;
          break;

        case "Month":
          startIST = new Date(now.getFullYear(), now.getMonth(), 1);
          endIST = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59,
            999,
          );
          break;

        case "Year":
          startIST = new Date(now.getFullYear(), 0, 1);
          endIST = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
          break;

        case "Custom":
          if (!startDate || !endDate) {
            throw new Error(
              "Start date and end date required for Custom filter",
            );
          }
          startIST = new Date(startDate);
          endIST = new Date(endDate);
          endIST.setHours(23, 59, 59, 999);
          break;

        default:
          return;
      }

      filterConditions.AND.push({
        createdAt: {
          gte: ISTtoUTC(startIST),
          lte: ISTtoUTC(endIST),
        },
      });
    };

    setDateFilter();

    filterConditions.AND.push({
      warehouseId,
    });

    // ---------- BASIC FILTERS ----------
    if (status) filterConditions.AND.push({ status });
    if (stageId) filterConditions.AND.push({ stageId });
    if (itemTypeId) filterConditions.AND.push({ itemTypeId });

    // ---------- SEARCH ----------
    if (search?.trim()) {
      const s = search.trim().toUpperCase();
      filterConditions.AND.push({
        OR: [{ item: s }, { subItem: s }, { serialNumber: s }],
      });
    }

    // ---------- PAGINATION ----------
    const skip = (Number(page) - 1) * Number(limit);

    // ---------- QUERY ----------
    const [processData, total] = await Promise.all([
      prisma.service_Process_Record.findMany({
        where: filterConditions,
        orderBy: { createdAt: "asc" },
        skip,
        take: Number(limit),
        select: {
          id: true,
          productName: true,
          itemName: true,
          subItemName: true,
          itemType: { select: { id: true, name: true } },
          serialNumber: true,
          quantity: true,
          stage: { select: { id: true, name: true } },
          status: true,
          createdAt: true,
          stageActivity: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              status: true,
              acceptedAt: true,
              startedAt: true,
              completedAt: true,
              isCurrent: true,
              failureReason: true,
              remarks: true,
              stage: { select: { id: true, name: true } },
              user: { select: { id: true, name: true } },
            },
          },
        },
      }),

      prisma.service_Process_Record.count({ where: filterConditions }),
    ]);

    // ---------- FORMAT ----------
    const modifiedData = processData.map((p) => ({
      serviceProcessId: p.id,
      productName: p.productName,
      itemName: p.itemName,
      subItemName: p.subItemName,
      itemType: p.itemType?.name,
      serialNumber: p.serialNumber,
      quantity: p.quantity,
      currentStage: p.stage?.name,
      processStatus: p.status,
      createdAt: p.createdAt,
      stageActivities: p.stageActivity.map((a) => ({
        activityId: a.id,
        stageId: a.stage.id,
        stageName: a.stage.name,
        activityStatus: a.status,
        isCurrent: a.isCurrent,
        failureReason: a.failureReason,
        remarks: a.remarks,
        acceptedAt: a.acceptedAt,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
      })),
    }));

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      page: Number(page),
      limit: Number(limit),
      total,
      totalPages: Math.ceil(total / limit),
      data: modifiedData,
    });
  } catch (error) {
    console.log("ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const updateStock2 = async (req, res) => {
  const uploadFiles = [];
  try {
    const empId = req?.user?.id;
    const warehouseId = req?.user?.warehouseId;
    const rawMaterialList = req?.body?.rawMaterialList;

    if (!empId || !warehouseId) {
      throw new Error("User or Warehouse not found");
    }

    if (!rawMaterialList) {
      throw new Error("Raw material list is required");
    }

    if (!req.files || !req.files.billPhoto) {
      throw new Error("Bill photo file not uploaded");
    }

    // Upload bill photos
    const billPhotoUrl = req.files.billPhoto.map((file) => {
      uploadFiles.push(file.path);
      return `/uploads/rawMaterial/billPhoto/${file.filename}`;
    });

    const parsedRawMaterialList = JSON.parse(rawMaterialList);

    if (
      !Array.isArray(parsedRawMaterialList) ||
      parsedRawMaterialList.length === 0
    ) {
      throw new Error("Raw material list is empty or invalid");
    }

    const result = await prisma.$transaction(async (tx) => {
      // Create stock movement batch
      const addBillPhoto = await tx.stockMovementBatch.create({
        data: {
          billPhotos: billPhotoUrl,
          createdBy: empId,
        },
      });

      for (const rawMaterial of parsedRawMaterialList) {
        const quantity = Number(rawMaterial.quantity);

        if (!rawMaterial.rawMaterialId || isNaN(quantity) || quantity <= 0) {
          throw new Error(
            "Invalid rawMaterial data: rawMaterialId and valid quantity required",
          );
        }

        const existingRawMaterial = await tx.rawMaterial.findUnique({
          where: { id: rawMaterial.rawMaterialId },
        });

        if (!existingRawMaterial) {
          throw new Error(
            `Raw Material not found: ${rawMaterial.rawMaterialId}`,
          );
        }

        // 🔹 Stock Movement (no warehouse relation now)
        await tx.stockMovement.create({
          data: {
            batchId: addBillPhoto.id,
            rawMaterialId: rawMaterial.rawMaterialId,
            userId: empId,
            warehouseId, // just a string now
            quantity,
            unit: existingRawMaterial.unit,
            type: "IN",
          },
        });

        // 🔹 Warehouse Stock UPSERT
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_rawMaterialId: {
              warehouseId,
              rawMaterialId: rawMaterial.rawMaterialId,
            },
          },
          update: {
            quantity: { increment: quantity },
            unit: existingRawMaterial.unit,
          },
          create: {
            warehouseId,
            rawMaterialId: rawMaterial.rawMaterialId,
            quantity,
            unit: existingRawMaterial.unit,
            isUsed: true,
          },
        });
      }

      return addBillPhoto;
    });

    return res.status(200).json({
      success: true,
      message: "Stock updated successfully",
      data: result,
    });
  } catch (error) {
    console.log("ERROR: ", error);

    // Cleanup uploaded files if transaction fails
    if (uploadFiles.length > 0) {
      await Promise.all(
        uploadFiles.map(async (filePath) => {
          try {
            await fs.unlink(filePath);
            console.log(`🗑 Deleted uploaded file: ${filePath}`);
          } catch (unlinkErr) {
            console.error(`Failed to delete file ${filePath}:`, unlinkErr);
          }
        }),
      );
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getStockMovementHistory2 = async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const warehouseId = req?.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not found for user",
      });
    }

    const batches = await prisma.stockMovementBatch.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        stockMovement: {
          where: {
            warehouseId: warehouseId, // ✅ FILTER HERE
          },
          select: {
            rawMaterial: {
              select: {
                id: true,
                name: true,
              },
            },
            quantity: true,
            unit: true,
            type: true,
          },
        },
      },
    });

    // Optional (recommended):
    // remove batches with no movements for this warehouse
    const filteredBatches = batches.filter(
      (batch) => batch.stockMovement.length > 0,
    );

    const formattedBatches = filteredBatches.map((batch) => ({
      ...batch,
      billPhotos: batch.billPhotos
        ? batch.billPhotos.map((photo) => `${baseUrl}${photo}`)
        : [],
    }));

    return res.status(200).json({
      success: true,
      message: "Stock movement history fetched successfully",
      data: formattedBatches,
    });
  } catch (error) {
    console.error("Error fetching stock movement history:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Version 3 API //

const getRawMaterialList3 = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user",
      });
    }

    const warehouseStocks = await prisma.warehouseStock.findMany({
      where: { warehouseId },
      select: {
        quantity: true,
        isUsed: true,
        itemId: true,
        itemType: true,
      },
    });

    // Separate ids by type
    const rawIds = warehouseStocks.filter(i => i.itemType === "RAW").map(i => i.itemId);
    const infraIds = warehouseStocks.filter(i => i.itemType === "INFRA").map(i => i.itemId);
    const toolIds = warehouseStocks.filter(i => i.itemType === "TOOL").map(i => i.itemId);

    const [rawMaterials, infraMaterials, tools] = await Promise.all([
      prisma.rawMaterial.findMany({
        where: { id: { in: rawIds } },
        select: { id: true, name: true, unit: true },
      }),
      prisma.infraMaterial.findMany({
        where: { id: { in: infraIds } },
        select: { id: true, name: true, unit: true },
      }),
      prisma.toolsEquipments.findMany({
        where: { id: { in: toolIds } },
        select: { id: true, name: true, unit: true },
      }),
    ]);

    const stockMap = {};
    for (const stock of warehouseStocks) {
      stockMap[stock.itemId] = stock;
    }

    const formatItems = (items, type) =>
      items.map(item => {
        const stockData = stockMap[item.id] || {};
        const qty = stockData.quantity ?? 0;
        const isUsed = stockData.isUsed ?? false;

        return {
          id: item.id,
          name: item.name,
          stock: formatStock(qty),
          rawStock: qty,
          unit: item.unit,
          isUsed,
          outOfStock: qty === 0,
          itemType: type,
        };
      });

    let allItems = [
      ...formatItems(rawMaterials, "RAW"),
      ...formatItems(infraMaterials, "INFRA"),
      ...formatItems(tools, "TOOL"),
    ];

    /* =========================================================
      MONGODB INSTALLATION ITEMS
    ========================================================== */

    const installationStocks = await InstallationInventory.find({
      warehouseId: warehouseId,
    }).lean();

    const installationIds = installationStocks.map(i => i.itemId);

    const installationItems = await SystemItem.find(
      { _id: { $in: installationIds } },
      { itemName: 1 }
    ).lean();

    const installationMap = {};
    installationItems.forEach(i => {
      installationMap[i._id.toString()] = i.itemName;
    });

    const formattedInstallation = installationStocks.map(stock => {
      const qty = stock.quantity ?? 0;

      return {
        id: stock.itemId.toString(),
        name: installationMap[stock.itemId.toString()] || "Unknown",
        stock: formatStock(qty),
        rawStock: qty,
        unit: stock.unit,
        isUsed: false,
        outOfStock: qty === 0,
        itemType: "INSTALLATION",
      };
    });

    allItems.push(...formattedInstallation);

    allItems.sort((a, b) => {
      if (a.isUsed === b.isUsed) return a.rawStock - b.rawStock;
      return a.isUsed ? -1 : 1;
    });

    allItems = allItems.map(({ rawStock, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      message: "Inventory fetched successfully",
      data: allItems,
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

const getWarehouseRawMaterialList3 = async (req, res) => {
  try {
    const warehouseId = req.user?.warehouseId;

    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not assigned to user.",
      });
    }

    const warehouse = await Warehouse.findById(warehouseId);
    if (!warehouse) {
      return res.status(400).json({
        success: false,
        message: "Warehouse not found.",
      });
    }


    const warehouseData = await prisma.warehouseStock.findMany({
      where: { warehouseId },
      select: {
        quantity: true,
        unit: true,
        isUsed: true,
        itemId: true,
        itemType: true,
      },
    });

    // separate ids by type
    const rawIds = warehouseData.filter(i => i.itemType === "RAW").map(i => i.itemId);
    const infraIds = warehouseData.filter(i => i.itemType === "INFRA").map(i => i.itemId);
    const toolIds = warehouseData.filter(i => i.itemType === "TOOL").map(i => i.itemId);

    const [rawMaterials, infraMaterials, tools] = await Promise.all([
      prisma.rawMaterial.findMany({
        where: { id: { in: rawIds } },
        select: { id: true, name: true, isUsed: true },
      }),
      prisma.infraMaterial.findMany({
        where: { id: { in: infraIds } },
        select: { id: true, name: true, isUsed: true },
      }),
      prisma.tools_Equipments.findMany({
        where: { id: { in: toolIds } },
        select: { id: true, name: true, isUsed: true },
      }),
    ]);

    const itemMap = {};

    rawMaterials.forEach(i => itemMap[i.id] = { ...i, type: "RAW" });
    infraMaterials.forEach(i => itemMap[i.id] = { ...i, type: "INFRA" });
    tools.forEach(i => itemMap[i.id] = { ...i, type: "TOOL" });

    let formattedData = warehouseData.map(stock => {
      const itemId = stock.itemId;
      const item = itemMap[itemId] || {};

      const qty = stock.quantity ?? 0;
      const isUsed = stock.isUsed ?? item.isUsed ?? false;

      return {
        id: itemId,
        name: item.name,
        stock: formatStock(qty),
        rawStock: qty,
        unit: stock.unit,
        isUsed,
        outOfStock: qty === 0,
        itemType: item.type,
      };
    });

    /* =========================================================
      INSTALLATION STOCK (MongoDB)
    ========================================================== */

    const installationStocks = await InstallationInventory.find({
      warehouseId: warehouseId,
    }).lean();

    const installationIds = installationStocks.map(i => i.itemId);

    const installationItems = await SystemItem.find(
      { _id: { $in: installationIds } },
      { itemName: 1 }
    ).lean();

    const installationMap = {};
    installationItems.forEach(i => {
      installationMap[i._id.toString()] = i.itemName;
    });

    const formattedInstallation = installationStocks.map(stock => {
      const qty = stock.quantity ?? 0;

      return {
        id: stock.itemId.toString(),
        name: installationMap[stock.itemId.toString()],
        stock: formatStock(qty),
        rawStock: qty,
        unit: stock.unit,
        isUsed: false,
        outOfStock: qty === 0,
        itemType: "INSTALLATION",
      };
    });

    formattedData.push(...formattedInstallation);

    /* =========================================================
       SORT (UNCHANGED)
    ========================================================== */

    formattedData.sort((a, b) => {
      if (a.isUsed === b.isUsed) return a.rawStock - b.rawStock;
      return a.isUsed ? -1 : 1;
    });

    const cleanedData = formattedData.map(({ rawStock, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      message: `${warehouse.warehouseName} inventory fetched successfully`,
      data: cleanedData,
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

const showIncomingItemRequest3 = async (req, res) => {
  try {
    const empId = req.query?.empId;
    if (!empId) throw new Error("Employee Id Not Found");

    const empData = await prisma.user.findFirst({
      where: { id: req?.user?.id },
      include: { role: true },
    });

    if (empData?.role?.name !== "Store") {
      return res.status(400).json({
        success: false,
        message: "Only Store Keeper Have Access For Incoming Item Request",
      });
    }

    const incomingItemRequest = await prisma.itemRequestData.findMany({
      where: { requestedBy: empId },
      select: {
        id: true,
        warehouseId: true,
        serviceProcessId: true,
        isProcessRequest: true,
        materialRequested: true,
        requestedBy: true,
        requestedAt: true,
        approved: true,
        approvedBy: true,
        approvedAt: true,
        materialGiven: true,
        declined: true,
        declinedBy: true,
        declinedAt: true,
        declinedRemarks: true,
      },
      orderBy: { requestedAt: "desc" },
    });

    const withNames = await Promise.all(
      incomingItemRequest.map(async (reqItem) => {
        const materials = reqItem.rawMaterialRequested || [];

        const rawIds = [];
        const infraIds = [];
        const toolIds = [];
        const installationIds = [];

        for (const m of materials) {
          if (m.rawMaterialId) rawIds.push(m.rawMaterialId);
          if (m.infraItemId) infraIds.push(m.infraItemId);
          if (m.toolsEquipmentId) toolIds.push(m.toolsEquipmentId);
          if (m.installationItemId) installationIds.push(m.installationItemId);
        }

        const [rawMaterials, infraMaterials, tools, installationItems] = await Promise.all([
          prisma.rawMaterial.findMany({
            where: { id: { in: rawIds } },
            select: { id: true, name: true, unit: true },
          }),
          prisma.infraMaterial.findMany({
            where: { id: { in: infraIds } },
            select: { id: true, name: true, unit: true },
          }),
          prisma.tools_Equipments.findMany({
            where: { id: { in: toolIds } },
            select: { id: true, name: true, unit: true },
          }),
          SystemItem.find(
            { _id: { $in: installationIds } },
            { itemName: 1, unit: 1 }
          ).lean(),
        ]);

        const rawMap = Object.fromEntries(rawMaterials.map(i => [i.id, i]));
        const infraMap = Object.fromEntries(infraMaterials.map(i => [i.id, i]));
        const toolMap = Object.fromEntries(tools.map(i => [i.id, i]));
        const installationMap = Object.fromEntries(
          installationItems.map(i => [i._id.toString(), i])
        );

        const enriched = materials.map((m) => {
          let item = null;
          let type = null;

          if (m.rawMaterialId && rawMap[m.rawMaterialId]) {
            item = rawMap[m.rawMaterialId];
            type = "RAW";
          }
          else if (m.infraItemId && infraMap[m.infraItemId]) {
            item = infraMap[m.infraItemId];
            type = "INFRA";
          }
          else if (m.toolsEquipmentId && toolMap[m.toolsEquipmentId]) {
            item = toolMap[m.toolsEquipmentId];
            type = "TOOL";
          }
          else if (m.installationItemId && installationMap[m.installationItemId]) {
            item = installationMap[m.installationItemId];
            type = "INSTALLATION";
          }

          return {
            ...m,
            name: item?.name || item?.itemName,
            unit: item?.unit,
            itemType: type,
          };
        });

        return { ...reqItem, materialRequested: enriched };
      })
    );

    res.json({
      success: true,
      message: "Data fetched successfully",
      data: withNames,
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


// {
//   rawMaterialRequested: [
//     { id: "1", quantity: 2, unit: "Nos", type: "RAW" },
//     { id: "4", quantity: 1, unit: "Nos", type: "INFRA" },
//     { id: "7", quantity: 1, unit: "Nos", type: "TOOL" },
//     { id: "mongoId123", quantity: 1, type: "INSTALLATION" }
//   ]
// }

const sanctionItemForRequest3 = async (req, res) => {
  try {
    const { itemRequestId } = req.body;
    const warehouseId = req.user?.warehouseId;

    if (!itemRequestId)
      return res.status(400).json({ success: false, message: "ItemRequestId Not Found" });

    if (!warehouseId)
      return res.status(400).json({ success: false, message: "Warehouse not assigned to user" });

    const itemRequestData = await prisma.itemRequestData.findFirst({
      where: { id: itemRequestId },
    });

    if (!itemRequestData) throw new Error("Item request not found");
    if (itemRequestData.approved === null) throw new Error("Item request is not approved.");
    if (itemRequestData.declined === true) throw new Error("Item request is declined.");
    if (itemRequestData.materialGiven) throw new Error("Material already sanctioned");

    const items = itemRequestData.rawMaterialRequested;

    if (!Array.isArray(items) || items.length === 0)
      throw new Error("No material data found in the request");

    const date = new Date();

    /* =====================================================
       🟢 STEP 1 — PRE VALIDATE INSTALLATION STOCK (Mongo)
    ===================================================== */
    for (const item of items) {
      const type = item.type || "raw";

      if (type === "installation") {
        const stock = await InstallationInventory.findOne({
          itemId: item.id,
          warehouseId,
        });

        if (!stock)
          throw new Error(`Installation item not available in warehouse`);

        if (Number(stock.quantity) < Number(item.quantity))
          throw new Error(`Insufficient Installation stock`);
      }
    }

    /* =====================================================
       🔵 STEP 2 — MYSQL TRANSACTION (RAW + INFRA + TOOL)
    ===================================================== */
    await prisma.$transaction(async (tx) => {

      for (const item of items) {
        const type = item.type || "raw";

        /* ================= RAW ================= */
        if (type === "raw") {

          const rawMaterialData = await tx.rawMaterial.findFirst({
            where: { id: item.rawMaterialId || item.id },
          });

          if (!rawMaterialData)
            throw new Error(`Raw material not found`);

          const warehouseStock = await tx.warehouseStock.findFirst({
            where: { warehouseId, rawMaterialId: rawMaterialData.id },
          });

          if (!warehouseStock)
            throw new Error(`Stock not available for ${rawMaterialData.name}`);

          if (Number(warehouseStock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient stock for ${rawMaterialData.name}`);

          await tx.warehouseStock.update({
            where: { id: warehouseStock.id },
            data: { quantity: { decrement: Number(item.quantity) } },
          });

          await tx.userItemStock.upsert({
            where: {
              empId_rawMaterialId: {
                empId: itemRequestData.requestedBy,
                rawMaterialId: rawMaterialData.id,
              },
            },
            update: { quantity: { increment: Number(item.quantity) } },
            create: {
              empId: itemRequestData.requestedBy,
              rawMaterialId: rawMaterialData.id,
              quantity: Number(item.quantity),
              unit: item.unit,
            },
          });
        }

        /* ================= INFRA ================= */
        else if (type === "infra") {

          const stock = await tx.warehouseStock.findFirst({
            where: { warehouseId, infraMaterialId: item.id },
          });

          if (!stock)
            throw new Error(`Infra item not available in warehouse`);

          if (Number(stock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient Infra stock`);

          await tx.warehouseStock.update({
            where: { id: stock.id },
            data: { quantity: { decrement: Number(item.quantity) } },
          });

          await tx.userItemStock.upsert({
            where: {
              empId_infraMaterialId: {
                empId: itemRequestData.requestedBy,
                infraMaterialId: item.id,
              },
            },
            update: { quantity: { increment: Number(item.quantity) } },
            create: {
              empId: itemRequestData.requestedBy,
              infraMaterialId: item.id,
              quantity: Number(item.quantity),
            },
          });
        }

        /* ================= TOOL ================= */
        else if (type === "tool") {

          const stock = await tx.warehouseStock.findFirst({
            where: { warehouseId, toolId: item.id },
          });

          if (!stock)
            throw new Error(`Tool not available in warehouse`);

          if (Number(stock.quantity) < Number(item.quantity))
            throw new Error(`Insufficient Tool stock`);

          await tx.warehouseStock.update({
            where: { id: stock.id },
            data: { quantity: { decrement: Number(item.quantity) } },
          });

          await tx.userItemStock.upsert({
            where: {
              empId_toolId: {
                empId: itemRequestData.requestedBy,
                toolId: item.id,
              },
            },
            update: { quantity: { increment: Number(item.quantity) } },
            create: {
              empId: itemRequestData.requestedBy,
              toolId: item.id,
              quantity: Number(item.quantity),
            },
          });
        }

        /* INSTALLATION skipped here (handled after commit) */
      }
    });

    /* =====================================================
       🟢 STEP 3 — MONGO COMMIT (AFTER MYSQL SUCCESS)
    ===================================================== */
    for (const item of items) {
      const type = item.type || "raw";

      if (type === "installation") {

        await InstallationInventory.updateOne(
          { itemId: item.id, warehouseId },
          { $inc: { quantity: -Number(item.quantity) } }
        );

        await InstallationInventory.updateOne(
          { itemId: item.id, assignedTo: itemRequestData.requestedBy },
          { $inc: { quantity: Number(item.quantity) } },
          { upsert: true }
        );
      }
    }

    /* =====================================================
       🟡 STEP 4 — MARK REQUEST COMPLETE
    ===================================================== */
    const result = await prisma.itemRequestData.update({
      where: { id: itemRequestId },
      data: {
        materialGiven: true,
        updatedAt: date,
        updatedBy: req.user.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Material sanctioned successfully",
      data: result,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const purchaseOrderReceivingBill3 = async (req, res) => {
  const userId = req.user?.id;
  const warehouseId = String(req.user?.warehouseId);
  let uploadedFilePath = null;

  const deleteUploadedFile = async () => {
    if (uploadedFilePath) {
      try {
        await fs.unlink(uploadedFilePath);
      } catch (err) {
        console.error("⚠️ Failed to delete uploaded file:", err);
      }
    }
  };

  const validateItems = async (items, po) => {
    for (const item of items) {
      console.log(item);
      const { itemId, itemSource, purchaseOrderItemId } = item;

      if (!itemId || !itemSource || !purchaseOrderItemId) {
        throw new Error("Invalid item data.");
      }
      console.log(purchaseOrderItemId, itemId, itemSource);
      const poItem = po.items.find((p) => p.id === purchaseOrderItemId);
      if (!poItem) {
        throw new Error(`PO item not found.`);
      }

      if (itemSource === "mongo") {
        const systemItem = await SystemItem.findById(itemId);
        if (!systemItem) throw new Error(`SystemItem not found.`);
      } else if (itemSource === "mysql") {
        const [raw, infra, tool] = await Promise.all([
          prisma.rawMaterial.findUnique({ where: { id: itemId } }),
          prisma.infraMaterial.findUnique({ where: { id: itemId } }),
          prisma.toolsEquipments.findUnique({ where: { id: itemId } }),
        ]);

        if (!raw && !infra && !tool) {
          throw new Error(`Item not found.`);
        }
      } else {
        throw new Error(`Invalid itemSource.`);
      }
    }
  };

  try {
    // ================= PARSE ITEMS =================
    if (req.body.items) {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch {
        return res
          .status(400)
          .json({ success: false, message: "Invalid items JSON." });
      }
    }

    const { purchaseOrderId, items, invoiceNumber } = req.body;
    const billFile = req.files?.billFile?.[0];

    if (!billFile)
      return res
        .status(400)
        .json({ success: false, message: "Bill file is required." });
    uploadedFilePath = path.join(
      __dirname,
      "../../uploads/purchaseOrder/receivingBill",
      billFile.filename,
    );

    if (
      !purchaseOrderId ||
      !invoiceNumber ||
      !Array.isArray(items) ||
      !items.length
    ) {
      await deleteUploadedFile();
      return res.status(400).json({
        success: false,
        message: "purchaseOrderId, invoiceNumber & items are required.",
      });
    }

    // ================= FETCH PO =================
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });

    if (!po) throw new Error("Purchase Order not found.");

    // if (po.approvalStatus !== "Approved") {
    //   throw new Error("Cannot receive items as PO not approved by admin.")
    // }

    // if (po.approvalStatus === 'Rejected') {
    //   throw new Error("Cannot receive items as PO is rejected by admin");
    // }

    if (["Cancelled", "Received"].includes(po.status))
      throw new Error(`PO already ${po.status}.`);

    if (String(po.warehouseId) !== warehouseId)
      return res
        .status(403)
        .json({ success: false, message: "Unauthorized warehouse access." });

    await validateItems(items, po);
    // ================= PRISMA + MONGO ATOMIC =================
    const { receiptResults, stockUpdates } = await prisma.$transaction(
      async (tx) => {
        const receiptResults = [];
        const stockUpdates = [];
        const mongoRollbackStack = [];

        // Save bill
        await tx.purchaseOrderBill.create({
          data: {
            purchaseOrderId,
            invoiceNumber,
            fileName: billFile.filename,
            fileUrl: `/uploads/purchaseOrder/receivingBill/${billFile.filename}`,
            mimeType: billFile.mimetype,
            uploadedBy: userId,
          },
        });

        for (const item of items) {
          const {
            purchaseOrderItemId,
            itemId,
            itemSource,
            itemName,
            goodQty = 0,
            damagedQty = 0,
            remarks = "",
          } = item;
          const poItem = po.items.find((p) => p.id === purchaseOrderItemId);
          if (!poItem) throw new Error(`PO item ${itemName} not found.`);

          const orderedQty = Number(poItem.quantity || 0);
          const alreadyReceived = Number(poItem.receivedQty || 0);
          const poUnit = poItem.unit?.toLowerCase();

          if (alreadyReceived + goodQty > orderedQty)
            throw new Error(`Over receiving ${itemName}`);
          const totalReceived = alreadyReceived + goodQty;

          // Receipt entry
          await tx.purchaseOrderReceipt.create({
            data: {
              purchaseOrderId,
              purchaseOrderItemId,
              invoiceNumber,
              itemId,
              itemSource,
              itemName,
              receivedQty: goodQty + damagedQty,
              goodQty,
              damagedQty,
              remarks,
              createdBy: userId,
              receivedDate: new Date(),
            },
          });

          // Update PO Item receivedQty
          await tx.purchaseOrderItem.update({
            where: { id: purchaseOrderItemId },
            data: { receivedQty: totalReceived },
          });

          // Damaged stock
          if (damagedQty > 0) {
            await tx.damagedStock.create({
              data: {
                purchaseOrderId,
                invoiceNumber,
                itemId,
                itemSource,
                itemName,
                unit: poItem.unit,
                quantity: damagedQty,
                status: "Pending",
                remarks,
                createdBy: userId,
              },
            });
          }

          // Stock updates
          if (goodQty > 0)
            stockUpdates.push({
              itemSource,
              itemId,
              goodQty,
              poUnit,
              warehouseId,
            });
          receiptResults.push({
            itemId,
            itemName,
            goodQty,
            damagedQty,
            remainingQty: orderedQty - totalReceived,
          });
        }

        // PO status update
        const updatedItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId },
          select: { quantity: true, receivedQty: true },
        });
        const allReceived = updatedItems.every(
          (i) => Number(i.receivedQty || 0) >= Number(i.quantity || 0),
        );
        const anyReceived = updatedItems.some(
          (i) => Number(i.receivedQty || 0) > 0,
        );

        let newStatus = po.status;
        if (allReceived) newStatus = "Received";
        else if (anyReceived) newStatus = "PartiallyReceived";

        if (newStatus !== po.status)
          await tx.purchaseOrder.update({
            where: { id: purchaseOrderId },
            data: { status: newStatus },
          });

        // MySQL stock update
        // MySQL stock update (RAW + INFRA + TOOLS)
        for (const s of stockUpdates.filter((s) => s.itemSource === "mysql")) {
          // Detect table
          const [rawMat, infraMat, toolMat] = await Promise.all([
            tx.rawMaterial.findUnique({ where: { id: s.itemId } }),
            tx.infraMaterial.findUnique({ where: { id: s.itemId } }),
            tx.tools_Equipments.findUnique({ where: { id: s.itemId } }),
          ]);

          const itemData = rawMat || infraMat || toolMat;

          if (!itemData) {
            throw new Error(`MySQL item not found during stock update.`);
          }

          const baseUnit = itemData.unit?.toLowerCase();
          const convUnit = itemData.conversionUnit?.toLowerCase();
          const factor = Number(itemData.conversionFactor || 1);

          let convertedQty = s.goodQty;

          if (baseUnit && s.poUnit !== baseUnit) {
            if (convUnit && s.poUnit === convUnit) {
              convertedQty = s.goodQty / factor;
            } else {
              throw new Error(`Invalid unit for item ${itemData.name}`);
            }
          }

          // Build WHERE condition dynamically
          let whereCondition = { warehouseId: s.warehouseId };

          if (rawMat) {
            whereCondition.rawMaterialId = s.itemId;
          } else if (infraMat) {
            whereCondition.infraItemId = s.itemId;
          } else if (toolMat) {
            whereCondition.toolsEquipmentId = s.itemId;
          }

          // Check if stock exists
          const existingStock = await tx.warehouseStock.findFirst({
            where: whereCondition,
          });

          if (!existingStock) {
            throw new Error(
              `Stock entry not found in warehouse for item ${itemData.name}`,
            );
          }

          // UPDATE ONLY
          await tx.warehouseStock.update({
            where: { id: existingStock.id },
            data: {
              quantity: {
                increment: convertedQty,
              },
            },
          });
        }

        // ================= MONGO STOCK =================
        try {
          for (const s of stockUpdates.filter(
            (s) => s.itemSource === "mongo",
          )) {
            const systemItem = await SystemItem.findById(s.itemId);
            if (!systemItem)
              throw new Error(`System item ${s.itemName} not found`);
            console.log(systemItem);
            const baseUnit = systemItem.unit?.toLowerCase().trim();
            console.log("System Item Unit: ", baseUnit);
            const convUnit = (
              systemItem.conversionUnit ??
              systemItem.converionUnit ??
              ""
            )
              ?.toLowerCase()
              .trim();
            console.log("System Item Con Unit: ", convUnit);
            const factor = Number(systemItem.conversionFactor || 1);
            console.log("System Item Conv Factor: ", factor);

            console.log({
              poUnit: s.poUnit?.toLowerCase().trim(),
              baseUnit,
              convUnit,
            });
            let convertedQty = s.goodQty;
            if (baseUnit && s.poUnit !== baseUnit) {
              if (convUnit && s.poUnit === convUnit)
                convertedQty = s.goodQty / factor;
              else
                throw new Error(
                  `Invalid unit for system item ${systemItem.itemName}`,
                );
            }

            const inv = await InstallationInventory.findOne({
              warehouseId: s.warehouseId,
              systemItemId: s.itemId,
            });
            if (inv) {
              mongoRollbackStack.push({
                type: "update",
                id: inv._id,
                oldQty: inv.quantity,
              });
              console.log("Previous", inv);
              inv.quantity += convertedQty;
              inv.updatedAt = new Date();
              inv.updatedByEmpId = req.user?.id;
              await inv.save();
              console.log("After", inv);
            } else {
              const created = await InstallationInventory.create({
                warehouseId: s.warehouseId,
                systemItemId: s.itemId,
                quantity: convertedQty,
              });
              mongoRollbackStack.push({ type: "create", id: created._id });
            }
          }
        } catch (mongoErr) {
          // Rollback Mongo + throw to rollback MySQL via transaction
          for (const r of mongoRollbackStack.reverse()) {
            if (r.type === "update")
              await InstallationInventory.findByIdAndUpdate(r.id, {
                quantity: r.oldQty,
              });
            if (r.type === "create")
              await InstallationInventory.findByIdAndDelete(r.id);
          }
          throw mongoErr;
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            entityType: "PurchaseOrder",
            entityId: purchaseOrderId,
            action: "RECEIVE_PO",
            performedBy: userId,
            oldValue: po,
            newValue: { receiptResults },
          },
        });

        return { receiptResults, stockUpdates };
      },
    );

    return res.status(200).json({
      success: true,
      message: "Purchase Order received successfully.",
      data: receiptResults,
    });
  } catch (err) {
    console.error("❌ PO Receiving Error:", err);
    await deleteUploadedFile();
    return res
      .status(500)
      .json({ success: false, message: err.message || "PO receiving failed." });
  }
};

const updateStock3 = async (req, res) => {
  const uploadFiles = [];

  try {
    const empId = req?.user?.id;
    const warehouseId = req?.user?.warehouseId;
    const rawMaterialList = req?.body?.rawMaterialList;

    if (!empId || !warehouseId) {
      throw new Error("User or Warehouse not found");
    }

    if (!rawMaterialList) {
      throw new Error("Raw material list is required");
    }

    if (!req.files || !req.files.billPhoto) {
      throw new Error("Bill photo file not uploaded");
    }

    // ================= Upload bill photos =================
    const billPhotoUrl = req.files.billPhoto.map((file) => {
      uploadFiles.push(file.path);
      return `/uploads/rawMaterial/billPhoto/${file.filename}`;
    });

    const parsedList = JSON.parse(rawMaterialList);

    if (!Array.isArray(parsedList) || parsedList.length === 0) {
      throw new Error("Raw material list is empty or invalid");
    }

    const result = await prisma.$transaction(async (tx) => {

      // ================= Create Batch =================
      const addBillPhoto = await tx.stockMovementBatch.create({
        data: {
          billPhotos: billPhotoUrl,
          createdBy: empId,
        },
      });

      // ================= Loop Items =================
      for (const item of parsedList) {

        // Backward compatibility
        const itemId = item.itemId;
        const itemType = item.itemType; // default raw
        const quantity = Number(item.quantity);

        if (!itemId || !itemType || isNaN(quantity) || quantity <= 0) {
          throw new Error(
            "Invalid item data: itemId, itemType and valid quantity required"
          );
        }

        // ================= Detect Table =================
        let raw = null;
        let infra = null;
        let tool = null;

        if (itemType === "raw") {
          raw = await tx.rawMaterial.findUnique({ where: { id: itemId } });
        } else if (itemType === "infra") {
          infra = await tx.infraMaterial.findUnique({ where: { id: itemId } });
        } else if (itemType === "tool") {
          tool = await tx.toolsEquipments.findUnique({ where: { id: itemId } });
        } else {
          throw new Error("Invalid itemType. Must be raw | infra | tool");
        }

        const itemData = raw || infra || tool;

        if (!itemData) {
          throw new Error(`Item not found: ${itemId}`);
        }

        const baseUnit = itemData.unit;

        // ================= Stock Movement =================
        await tx.stockMovement.create({
          data: {
            batchId: addBillPhoto.id,
            rawMaterialId: raw ? itemId : null,
            infraItemId: infra ? itemId : null,
            toolsEquipmentId: tool ? itemId : null,
            userId: empId,
            warehouseId,
            quantity,
            unit: baseUnit,
            type: "IN",
          },
        });

        // ================= Warehouse Stock UPSERT =================
        const whereCondition = { warehouseId };
        // const createData = {
        //   warehouseId,
        //   quantity,
        //   unit: baseUnit,
        //   isUsed: true,
        // };

        if (raw) {
          whereCondition.rawMaterialId = itemId;
          //createData.rawMaterialId = itemId;
        } else if (infra) {
          whereCondition.infraItemId = itemId;
          //createData.infraItemId = itemId;
        } else if (tool) {
          whereCondition.toolsEquipmentId = itemId;
          //createData.toolsEquipmentId = itemId;
        }

        await tx.warehouseStock.upsert({
          where: whereCondition,
          update: {
            quantity: { increment: quantity },
            unit: baseUnit,
          },
          //create: createData,
        });
      }

      return addBillPhoto;
    });

    return res.status(200).json({
      success: true,
      message: "Stock updated successfully",
      data: result,
    });

  } catch (error) {
    console.log("ERROR: ", error);

    // ================= Cleanup Uploaded Files =================
    if (uploadFiles.length > 0) {
      await Promise.all(
        uploadFiles.map(async (filePath) => {
          try {
            await fs.unlink(filePath);
            console.log(`🗑 Deleted uploaded file: ${filePath}`);
          } catch (unlinkErr) {
            console.error(`Failed to delete file ${filePath}:`, unlinkErr);
          }
        }),
      );
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// GET outstanding returnable materials for a given employee
// GET /store-keeper/returnMaterial/outstanding?empId=xxx
// ─────────────────────────────────────────────────────────────────────────────
const getOutstandingReturnableMaterials = async (req, res) => {
  try {
    const { empId } = req.query;
    const warehouseId = req.user?.warehouseId;

    if (!empId) {
      return res.status(400).json({ success: false, message: "empId is required" });
    }
    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "Warehouse not assigned to user" });
    }

    // Verify employee exists
    const emp = await prisma.user.findUnique({
      where: { id: empId },
      select: { id: true, name: true },
    });
    if (!emp) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    // Fetch all direct item issues for this employee (same warehouse)
    const issues = await prisma.directItemIssue.findMany({
      where: { issuedTo: empId, warehouseId },
      select: { rawMaterialIssued: true },
    });

    // Aggregate RETURNABLE quantities by itemId
    // itemId can be a MySQL UUID or a MongoDB ObjectId string
    const issuedMap = new Map(); // itemId -> { totalIssued, unit, isMongo }

    for (const issue of issues) {
      const items = Array.isArray(issue.rawMaterialIssued) ? issue.rawMaterialIssued : [];
      for (const item of items) {
        if (item.issueType === "RETURNABLE" && item.rawMaterialId) {
          const qty = parseFloat(item.quantity) || 0;
          const isMongo = mongoose.Types.ObjectId.isValid(item.rawMaterialId);
          if (!issuedMap.has(item.rawMaterialId)) {
            issuedMap.set(item.rawMaterialId, { totalIssued: 0, unit: item.unit || null, isMongo });
          }
          issuedMap.get(item.rawMaterialId).totalIssued += qty;
        }
      }
    }

    if (issuedMap.size === 0) {
      return res.json({ success: true, data: [] });
    }

    // Fetch existing returns for this employee (covers both rawMaterialId and installationItemId)
    const existingReturns = await prisma.materialReturn.findMany({
      where: { empId, warehouseId },
      select: { rawMaterialId: true, installationItemId: true, returnedQty: true },
    });

    // Aggregate returned quantities — use whichever field is set as the key
    const returnedMap = new Map();
    for (const ret of existingReturns) {
      const itemId = ret.rawMaterialId || ret.installationItemId;
      if (!itemId) continue;
      returnedMap.set(itemId, (returnedMap.get(itemId) || 0) + ret.returnedQty);
    }

    // Split IDs by source for name resolution
    const mysqlIds = [];
    const mongoIds = [];
    for (const [itemId, data] of issuedMap.entries()) {
      if (data.isMongo) mongoIds.push(itemId);
      else mysqlIds.push(itemId);
    }

    // Fetch MySQL raw material names
    const rawMaterials = mysqlIds.length
      ? await prisma.rawMaterial.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true, name: true, unit: true },
        })
      : [];
    const mysqlNameMap = {};
    rawMaterials.forEach((rm) => { mysqlNameMap[rm.id] = rm; });

    // Fetch MongoDB installation item names
    let mongoNameMap = {};
    if (mongoIds.length) {
      const mongoItems = await SystemItem.find(
        { _id: { $in: mongoIds } },
        { itemName: 1, unit: 1 }
      ).lean();
      mongoItems.forEach((item) => {
        mongoNameMap[item._id.toString()] = { name: item.itemName, unit: item.unit };
      });
    }

    // Build response — only items with remaining > 0
    const result = [];
    for (const [itemId, data] of issuedMap.entries()) {
      const totalReturned = returnedMap.get(itemId) || 0;
      const remaining = Math.max(0, data.totalIssued - totalReturned);
      if (remaining <= 0) continue;

      const nameData = data.isMongo ? mongoNameMap[itemId] : mysqlNameMap[itemId];
      result.push({
        rawMaterialId: itemId,
        name: nameData?.name || itemId,
        unit: data.unit || nameData?.unit || null,
        totalIssued: data.totalIssued,
        totalReturned,
        remaining,
        itemSource: data.isMongo ? "mongo" : "mysql",
      });
    }

    return res.json({
      success: true,
      message: "Outstanding returnable materials fetched successfully",
      employeeName: emp.name,
      data: result,
    });
  } catch (error) {
    console.error("getOutstandingReturnableMaterials ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST return materials to store
// POST /store-keeper/returnMaterial
// body: { empId, returns: [{ rawMaterialId, returnQty, unit }], remarks }
// ─────────────────────────────────────────────────────────────────────────────
const returnMaterial = async (req, res) => {
  try {
    const returnedBy = req.user?.id;
    const warehouseId = req.user?.warehouseId;

    if (!returnedBy) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    if (!warehouseId) {
      return res.status(400).json({ success: false, message: "Warehouse not assigned to user" });
    }

    const { empId, returns, remarks } = req.body;

    if (!empId) {
      return res.status(400).json({ success: false, message: "empId is required" });
    }
    if (!Array.isArray(returns) || returns.length === 0) {
      return res.status(400).json({ success: false, message: "returns must be a non-empty array" });
    }

    // Verify employee
    const emp = await prisma.user.findUnique({
      where: { id: empId },
      select: { id: true, name: true },
    });
    if (!emp) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    // Build issued totals for RETURNABLE items from DirectItemIssue records
    const issues = await prisma.directItemIssue.findMany({
      where: { issuedTo: empId, warehouseId },
      select: { rawMaterialIssued: true },
    });

    const issuedTotals = new Map(); // itemId -> qty
    for (const issue of issues) {
      const items = Array.isArray(issue.rawMaterialIssued) ? issue.rawMaterialIssued : [];
      for (const item of items) {
        if (item.issueType === "RETURNABLE" && item.rawMaterialId) {
          const qty = parseFloat(item.quantity) || 0;
          issuedTotals.set(item.rawMaterialId, (issuedTotals.get(item.rawMaterialId) || 0) + qty);
        }
      }
    }

    // Build already-returned totals (both mysql and mongo returns)
    const existingReturns = await prisma.materialReturn.findMany({
      where: { empId, warehouseId },
      select: { rawMaterialId: true, installationItemId: true, returnedQty: true },
    });
    const returnedTotals = new Map();
    for (const r of existingReturns) {
      const itemId = r.rawMaterialId || r.installationItemId;
      if (!itemId) continue;
      returnedTotals.set(itemId, (returnedTotals.get(itemId) || 0) + r.returnedQty);
    }

    // Classify each return item as MySQL or MongoDB
    const mysqlReturns = [];
    const mongoReturns = [];

    for (const item of returns) {
      const { rawMaterialId, returnQty } = item;

      if (!rawMaterialId) {
        return res.status(400).json({ success: false, message: "rawMaterialId is required for each return item" });
      }
      const qty = parseFloat(returnQty);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ success: false, message: `returnQty must be > 0 for item ${rawMaterialId}` });
      }

      const totalIssued = issuedTotals.get(rawMaterialId) || 0;
      if (totalIssued === 0) {
        return res.status(400).json({
          success: false,
          message: `No RETURNABLE issues found for item ${rawMaterialId} and this employee`,
        });
      }

      const alreadyReturned = returnedTotals.get(rawMaterialId) || 0;
      const outstanding = totalIssued - alreadyReturned;
      if (qty > outstanding) {
        return res.status(400).json({
          success: false,
          message: `Return quantity ${qty} exceeds outstanding ${outstanding} for item ${rawMaterialId}`,
        });
      }

      const isMongo = mongoose.Types.ObjectId.isValid(rawMaterialId);
      if (isMongo) {
        mongoReturns.push({ ...item, qty });
      } else {
        mysqlReturns.push({ ...item, qty });
      }
    }

    // ── STEP 1: Handle MySQL raw material returns inside a Prisma transaction ──
    if (mysqlReturns.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const item of mysqlReturns) {
          const { rawMaterialId, qty, unit } = item;

          // Restore to warehouse stock
          await tx.warehouseStock.upsert({
            where: {
              warehouseId_rawMaterialId: {
                warehouseId,
                rawMaterialId,
              },
            },
            update: { quantity: { increment: qty } },
            create: {
              warehouseId,
              rawMaterialId,
              quantity: qty,
              unit: unit || null,
              isUsed: true,
            },
          });

          // Deduct from employee's user stock
          await tx.userItemStock.updateMany({
            where: { empId, rawMaterialId },
            data: { quantity: { decrement: qty } },
          });

          // Record return
          await tx.materialReturn.create({
            data: {
              empId,
              rawMaterialId,
              installationItemId: null,
              returnedQty: qty,
              unit: unit || null,
              warehouseId,
              returnedBy,
              remarks: remarks || null,
            },
          });
        }
      });
    }

    // ── STEP 2: Handle MongoDB installation material returns ──
    for (const item of mongoReturns) {
      const { rawMaterialId: installationItemId, qty, unit } = item;

      // Verify the installation item exists in Mongo
      const systemItem = await SystemItem.findById(installationItemId);
      if (!systemItem) {
        throw new Error(`Installation item not found: ${installationItemId}`);
      }

      // Restore qty to warehouse inventory (MongoDB)
      await InstallationInventory.updateOne(
        { warehouseId, systemItemId: installationItemId },
        { $inc: { quantity: qty } }
      );

      // Deduct from employee's user stock (MongoDB)
      await InstallationInventory.updateOne(
        { assignedTo: empId, itemId: installationItemId },
        { $inc: { quantity: -qty } }
      );

      // Record return (rawMaterialId = null for mongo items)
      await prisma.materialReturn.create({
        data: {
          empId,
          rawMaterialId: null,
          installationItemId,
          returnedQty: qty,
          unit: unit || null,
          warehouseId,
          returnedBy,
          remarks: remarks || null,
        },
      });
    }

    return res.json({ success: true, message: "Material returned to store successfully" });
  } catch (error) {
    console.error("returnMaterial ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports = {
  getLineWorkerList,
  getRawMaterialList,
  getWarehouseRawMaterialList,
  showIncomingItemRequest,
  approveOrDeclineItemRequest,
  sanctionItemForRequest,
  getUserItemStock,
  getUserItemStockDetails,
  showProcessData,
  updateStock,
  getStockMovementHistory,
  markRawMaterialUsedOrNotUsed,
  markSystemItemUsedOrNotUsed,
  getPendingPOsForReceiving,
  purchaseOrderReceivingBill,
  purchaseOrderReceivingBill2,
  getLineWorkerList2,
  getRawMaterialList2,
  updateStock2,
  getStockMovementHistory2,
  showProcessData2,
  sanctionItemForRequest2,
  directItemIssue,
  getDirectItemIssueHistory,
  newDirectItemIssue,
  getOutstandingReturnableMaterials,
  returnMaterial,
};

// [{
//   "purchaseOrderId": "8ce7d1a0-9f0d-4c71-a764-c452f75f3869",
//   "items": [
//     {
//       "purchaseOrderItemId": "059206e2-f682-49df-af58-932ae13355fe",
//       "itemId": "68fcafcbbd822233afe7a536",
//       "itemSource": "mongo",
//       "itemName": "9 Panel Bracing Clamp",
//       "receivedQty": 100,
//       "goodQty": 95,
//       "damagedQty": 5,
//       "remarks": "Received partial batch"
//     },
//     {
//       "purchaseOrderItemId": "e676879f-fa31-456f-8f01-d9c52a8d76f0",
//       "itemId": "0a208825-1e45-487f-bcf3-c32567d8e27d",
//       "itemSource": "mysql",
//       "itemName": "Bowl SP17",
//       "receivedQty":80,
//       "goodQty": 80,
//       "damagedQty": 0,
//       "remarks": "Received partial batch"
//     }
//   ]
// }]

[
  {
    id: "8ce7d1a0-9f0d-4c71-a764-c452f75f3869",
    poNumber: "1998DL25260003",
    companyId: "b21ea9a7-1e04-4088-ba00-c6e773291a9b",
    companyName: "UDA MANDI SERVICE PVT LTD",
    vendorId: "1dddc176-4d2d-4d24-bfe6-695a0cf72b30",
    vendorName: "WAAREE ENERGIES LIMITED",
    warehouseId: "67446a8b27dae6f7f4d985dd",
    warehouseName: "Bhiwani",
    poDate: "2025-12-23T09:32:29.578Z",
    status: "Draft",
    approvalStatus: "Pending",
    items: [
      {
        id: "059206e2-f682-49df-af58-932ae13355fe",
        itemId: "68fcafcbbd822233afe7a536",
        itemSource: "mongo",
        itemName: "9 Panel Bracing Clamp",
        hsnCode: "HSN7654",
        modelNumber: "M7654",
        unit: "Pcs/Nos",
        quantity: "150",
        receivedQty: "0",
      },
      {
        id: "e676879f-fa31-456f-8f01-d9c52a8d76f0",
        itemId: "0a208825-1e45-487f-bcf3-c32567d8e27d",
        itemSource: "mysql",
        itemName: "Bowl SP17",
        hsnCode: "HSN1234",
        modelNumber: "M1234",
        unit: "Pcs/Nos",
        quantity: "100",
        receivedQty: "0",
      },
    ],
  },
];

[
  {
    purchaseOrderItemId: "62ab3cc6-d518-49d7-ab6d-0cbc14f716f5",
    itemId: "682c5c99cb3e04e576ba36f4",
    itemSource: "mongo",
    itemName: "10 Panel Purlin (HDG)",
    receivedQty: 50,
    goodQty: 50,
    damagedQty: 0,
    remarks: "Received partial batch",
  },
  {
    purchaseOrderItemId: "a6e213e7-8d2c-4ca9-9566-412356da6b6e",
    itemId: "68fcaff4bd822233afe7a59e",
    itemSource: "mongo",
    itemName: "4 Panel U Clamp",
    receivedQty: 80,
    goodQty: 80,
    damagedQty: 0,
    remarks: "Received partial batch",
  },
];

[
  {
    id: "5534c015-0bd6-4951-8ba6-d89952b5b202",
    poNumber: "GEPLHR25260040",
    companyId: "4247d6fc-2a9c-42f5-925f-103fe1e014ac",
    companyName: "Galo Energy Private Limited",
    vendorId: "56816fd3-5fab-41da-be38-0b7947b6406a",
    vendorName: "Apna Bazar",
    damagedStock: [
      {
        id: "2fa54831-cee5-4c88-a260-b434c61cbad7",
        itemId: "682c5c99cb3e04e576ba36f4",
        itemSource: "mongo",
        itemName: "10 Panel Purlin HDG Nitesh",
        quantity: "17",
        unit: "Pcs",
      },
    ],
  },
];
