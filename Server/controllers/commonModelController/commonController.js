const XLSX = require("xlsx");
const mongoose = require("mongoose");
const SystemOrder = require("../../models/systemInventoryModels/systemOrderSchema");
const AppVersion = require("../../models/commonModels/appVersionSchema");
const InstallationInventory = require("../../models/systemInventoryModels/installationInventorySchema");
const Warehouse = require("../../models/serviceInventoryModels/warehouseSchema");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const createAppVersion = async (req, res) => {
    try {
        const newAppVersion = new AppVersion({
            appVersion: 1,
            link: "https://service.galosolar.com"
        });

        await newAppVersion.save();
        return res.status(200).json({
            success: true,
            message: "App Version Added Successfully"
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

const WAREHOUSE_ID = "67beef9e2fffc2145da032f3";
const updateInstallationInventoryFromExcel = async (req, res) => {
  try {
    // Validate file
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: "No Excel file uploaded" });
    }

    // Read Excel buffer
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheetData.length) {
      return res.status(400).json({ success: false, message: "Excel file is empty" });
    }

    let updatedCount = 0;
    let notFound = [];

    // Loop through each row
    for (const row of sheetData) {
      const { systemItemId, quantity } = row;

      if (!systemItemId || typeof quantity !== "number") {
        console.log("Skipping invalid row:", row);
        continue;
      }

      const updated = await InstallationInventory.findOneAndUpdate(
        { warehouseId: WAREHOUSE_ID, systemItemId },
        {
          $set: {
            quantity,
            updatedAt: new Date(),
          },
        },
        { new: true }
      );

      if (updated) updatedCount++;
      else notFound.push(systemItemId);
    }

    return res.status(200).json({
      success: true,
      message: `✅ Updated ${updatedCount} inventory records successfully.`,
      notFound: notFound.length ? notFound : undefined,
    });

  } catch (error) {
    console.error("❌ Error updating installation inventory:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const importSystemOrdersFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file is required",
      });
    }

    // Read workbook
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty",
      });
    }

    const payload = [];

    rows.forEach((row, index) => {
      const { warehouseId, systemId, pumpId, pumpHead } = row;

      if (!warehouseId || !systemId || !pumpHead) {
        throw new Error(`Missing required fields at row ${index + 2}`);
      }

      payload.push({
        warehouseId: new mongoose.Types.ObjectId(warehouseId),
        systemId: new mongoose.Types.ObjectId(systemId),
        pumpId: pumpId ? new mongoose.Types.ObjectId(pumpId) : null,
        pumpHead: pumpHead || "UNKNOWN",
        totalOrder: 0,
        dispatchedOrder: 0,
      });
    });

    await SystemOrder.insertMany(payload);

    return res.status(201).json({
      success: true,
      message: "System orders imported successfully",
      insertedCount: payload.length,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Excel import failed",
    });
  }
};




// Resolve + validate the warehouse a container request is for.
// Logged-in user's warehouse wins; otherwise `warehouseId` from body/query.
const resolveContainerWarehouse = async (req) => {
  const warehouseId =
    req.user?.warehouseId || req.body?.warehouseId || req.query?.warehouseId;

  if (!warehouseId) return { error: "warehouseId is required" };
  if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
    return { error: "Invalid warehouseId" };
  }

  const warehouse = await Warehouse.findById(warehouseId).lean();
  if (!warehouse) return { error: "Warehouse not found", status: 404 };

  return { warehouseId: String(warehouseId) };
};

// CREATE container
const createContainer = async (req, res) => {
  try {
    const { name } = req.body;

    // Validate container name
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Container name is required",
      });
    }

    const { warehouseId, error, status } = await resolveContainerWarehouse(req);
    if (error) {
      return res.status(status || 400).json({ success: false, message: error });
    }

    const containerName = name.trim();

    // Container names are unique per warehouse
    const existingContainer = await prisma.container_list.findFirst({
      where: {
        name: containerName,
        warehouse_id: warehouseId,
      },
    });

    if (existingContainer) {
      return res.status(409).json({
        success: false,
        message: "Container name already exists in this warehouse",
      });
    }

    // Create container
    const container = await prisma.container_list.create({
      data: {
        name: containerName,
        warehouse_id: warehouseId,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Container created successfully",
      data: container,
    });
  } catch (error) {
    console.error("Create container error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create container",
    });
  }
};



// GET all containers of a warehouse
const getAllContainers = async (req, res) => {
  try {
    const { warehouseId, error, status } = await resolveContainerWarehouse(req);
    if (error) {
      return res.status(status || 400).json({ success: false, message: error });
    }

    const containers = await prisma.container_list.findMany({
      where: { warehouse_id: warehouseId },
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      success: true,
      count: containers.length,
      data: containers,
    });
  } catch (error) {
    console.error("Get containers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch containers",
    });
  }
};

// UPDATE container
const updateContainer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Container name is required",
      });
    }

    const existingContainer = await prisma.container_list.findUnique({
      where: { id },
    });

    if (!existingContainer) {
      return res.status(404).json({
        success: false,
        message: "Container not found",
      });
    }

    // Keep names unique within the container's warehouse
    const duplicate = await prisma.container_list.findFirst({
      where: {
        name: name.trim(),
        warehouse_id: existingContainer.warehouse_id,
        NOT: { id },
      },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Container name already exists in this warehouse",
      });
    }

    const updatedContainer = await prisma.container_list.update({
      where: { id },
      data: {
        name: name.trim(),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Container updated successfully",
      data: updatedContainer,
    });
  } catch (error) {
    console.error("Update container error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update container",
    });
  }
};

// DELETE container
const deleteContainer = async (req, res) => {
  try {
    const { id } = req.params;

    const existingContainer = await prisma.container_list.findUnique({
      where: { id },
    });

    if (!existingContainer) {
      return res.status(404).json({
        success: false,
        message: "Container not found",
      });
    }

    await prisma.container_list.delete({
      where: { id },
    });

    return res.status(200).json({
      success: true,
      message: "Container deleted successfully",
    });
  } catch (error) {
    console.error("Delete container error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete container",
    });
  }
};





module.exports = {
    createAppVersion,
    updateInstallationInventoryFromExcel,
    importSystemOrdersFromExcel,
    createContainer,
    getAllContainers,
    updateContainer,
    deleteContainer
}