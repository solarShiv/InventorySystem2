const prisma = require("../../config/prismaClient");
const PO_list_for_inverter = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;

    page = Math.max(parseInt(page, 10) || 1, 1);
    limit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);

    const skip = (page - 1) * limit;

    const where = {
      itemName: {
        contains: "inverter",
      },
    };

    const [items, total] = await Promise.all([
      prisma.purchaseOrderItem.findMany({
        where,
        skip,
        take: limit,

        orderBy: {
          createdAt: "desc",
        },

        select: {
          id: true,
          itemName: true,
          modelNumber: true,
          unit: true,
          quantity: true,
          receivedQty: true,
          itemGSTType: true,
          itemDetail: true,

          purchaseOrder: {
            select: {
              poNumber: true,
              financialYear: true,
              poDate: true,
              status: true,
              pdfUrl: true,
              pdfName: true,
              companyName: true,
              vendorName: true,
            },
          },
        },
      }),

      prisma.purchaseOrderItem.count({
        where,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      message: "Inverter items fetched successfully",
      data: items,
      pagination: {
        currentPage: page,
        limit,
        totalItems: total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("PO_list_for_inverter error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  PO_list_for_inverter,
};
