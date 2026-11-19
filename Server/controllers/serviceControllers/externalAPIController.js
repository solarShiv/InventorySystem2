const prisma = require("../../config/prismaClient");

const getVehicleReceiptStatusToday = async (req, res) => {
  try {
    const { vehicleNo, entryTime, warehouseId } = req.query;
    console.log("body :", req.query);
    if (!vehicleNo || !entryTime) {
      return res.status(400).json({
        success: false,
        message: "vehicleNo and entryTime is required",
      });
    }

    const normalizedVehicle = vehicleNo.toUpperCase().trim();

    const entryDate = new Date(entryTime);
    console.log("entry time",entryDate);

    if (isNaN(entryDate)) {
      return res.status(400).json({
        success: false,
        message: "Invalid entryTime format",
      });
    }

    const now = new Date();
    console.log(now);

    // const count = await prisma.purchaseOrderReceipt.count({
    //   where: {
    //     vehicleNumber: normalizedVehicle,
    //     receivedDate: {
    //       gte: entryDate,
    //       lte: now,
    //     },
    //     purchaseOrder: {
    //       warehouseId: "67446a8b27dae6f7f4d985dd",
    //     }
    //   },
    // });

    const receipt = await prisma.purchaseOrderReceipt.findFirst({
      where: {
        vehicleNumber: normalizedVehicle,
        receivedDate: {
          gte: entryDate,
          lte: now,
        },
        purchaseOrder: {
          warehouseId: warehouseId,
        },
      },
      select: { id: true },
    });
    console.log(receipt);

    return res.status(200).json({
      success: true,
      data: {
        receivedAfterEntry: !!receipt,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getVehicleReceiptStatusToday,
};
