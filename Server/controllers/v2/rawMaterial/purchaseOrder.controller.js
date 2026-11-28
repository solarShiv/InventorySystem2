const prisma = require("../../../config/prismaClient");

const MAX_LIMIT = 100;

const toPositiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const clean = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * GET PO list (v2) — same response shape as v1 getPOList, faster:
 *  - no extra user/role lookup (tokenVerification already checked the role)
 *  - count + page run in parallel
 *  - page POs are fetched first (small row), then items, receipts and the
 *    receivers' names are loaded in parallel with one IN query each
 *  - stable sort (createdAt, id) backed by the PurchaseOrder_createdAt_idx index
 */
const getPOList = async (req, res) => {
  try {
    const poNumber = clean(req.query.poNumber);
    const company = clean(req.query.company);
    const vendor = clean(req.query.vendor);
    const itemName = clean(req.query.itemName);

    const pageNumber = toPositiveInt(req.query.page, 1);
    const pageSize = Math.min(toPositiveInt(req.query.limit, 20), MAX_LIMIT);
    const skip = (pageNumber - 1) * pageSize;

    const where = {};
    if (poNumber) where.poNumber = { contains: poNumber };
    if (company) where.companyName = { contains: company };
    if (vendor) where.vendorName = { contains: vendor };
    if (itemName) where.items = { some: { itemName: { contains: itemName } } };

    // 1. Count + current page in parallel
    const [totalCount, poList] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          poNumber: true,
          poDate: true,
          companyId: true,
          companyName: true,
          vendorId: true,
          vendorName: true,
          currency: true,
          foreignGrandTotal: true,
          grandTotal: true,
          status: true,
          expectedDeliveryDate: true,
          source_po_id: true,
        },
      }),
    ]);

    if (!poList.length) {
      return res.status(200).json({
        success: true,
        message: "PO list fetched successfully",
        data: [],
        pagination: {
          total: totalCount,
          page: pageNumber,
          limit: pageSize,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      });
    }

    const poIds = poList.map((po) => po.id);

    // 2. Items + receipts for this page only, in parallel
    const [items, receipts] = await Promise.all([
      prisma.purchaseOrderItem.findMany({
        where: { purchaseOrderId: { in: poIds } },
        select: {
          id: true,
          purchaseOrderId: true,
          itemId: true,
          itemSource: true,
          itemName: true,
          unit: true,
          quantity: true,
          receivedQty: true,
          itemDetail: true,
          serial_no: true,
        },
      }),
      prisma.purchaseOrderReceipt.findMany({
        where: { purchaseOrderId: { in: poIds } },
        orderBy: { receivedDate: "desc" },
        select: {
          id: true,
          purchaseOrderId: true,
          purchaseOrderItemId: true,
          itemId: true,
          itemSource: true,
          itemName: true,
          receivedQty: true,
          goodQty: true,
          damagedQty: true,
          receivedDate: true,
          remarks: true,
          receivingBill: true,
          invoiceNumber: true,
          vehicleNumber: true,
          createdAt: true,
          createdBy: true,
        },
      }),
    ]);

    // 3. Receiver names: one query for the distinct users
    const userIds = [...new Set(receipts.map((r) => r.createdBy).filter(Boolean))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userName = new Map(users.map((u) => [u.id, u.name]));

    // 4. Group by PO in memory
    const itemsByPo = new Map();
    for (const { purchaseOrderId, ...item } of items) {
      if (!itemsByPo.has(purchaseOrderId)) itemsByPo.set(purchaseOrderId, []);
      itemsByPo.get(purchaseOrderId).push(item);
    }

    const receiptsByPo = new Map();
    for (const { purchaseOrderId, createdBy, ...receipt } of receipts) {
      if (!receiptsByPo.has(purchaseOrderId)) receiptsByPo.set(purchaseOrderId, []);
      receiptsByPo.get(purchaseOrderId).push({
        ...receipt,
        receivedBy: (createdBy && userName.get(createdBy)) || null,
      });
    }

    const data = poList.map((po) => ({
      ...po,
      items: itemsByPo.get(po.id) || [],
      receipts: receiptsByPo.get(po.id) || [],
      displayGrandTotal:
        po.currency === "INR" ? po.grandTotal : po.foreignGrandTotal,
    }));

    return res.status(200).json({
      success: true,
      message: "PO list fetched successfully",
      data,
      pagination: {
        total: totalCount,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching PO list (v2):", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

module.exports = {
  getPOList,
};
