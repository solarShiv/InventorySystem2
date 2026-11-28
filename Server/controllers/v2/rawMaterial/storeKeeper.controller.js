const prisma = require("../../../config/prismaClient");
const fs = require("fs/promises");
const path = require("path");
const {
  AppError,
  prepareItems,
  mergeContainerStock,
  applyMongoStock,
  receiptResponse,
} = require("../../rawMaterialItemsController/storekeeperController");
const { getItemDescriptionMap, keyOf } = require("../../../util/itemDescription");

const QTY_EPSILON = 0.0001;
const VEHICLE_REQUIRED_WAREHOUSES = new Set(["Bhiwani", "Malanpur Warehouse"]);
const TX_OPTIONS = { maxWait: 10000, timeout: 30000 };

// How a received line affects warehouse stock.
//  "add"  -> increase stock of the receiving (this PO's) warehouse
//  "skip" -> resale whose goods were already counted when the source PO was received
const STOCK_MODE = { ADD: "add", SKIP: "skip" };

const itemKey = (itemSource, itemId) => `${itemSource}:${String(itemId)}`;
const normUnit = (u) => (u || "").toString().toLowerCase().trim();
const addsStock = (l) => l.goodQty > 0 && l.stockMode !== STOCK_MODE.SKIP;

/**
 * Recomputes and persists PO status from its items' receivedQty.
 */
const syncPoStatus = async (tx, purchaseOrderId, currentStatus) => {
  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId },
    select: { quantity: true, receivedQty: true },
  });
  const allReceived = items.every(
    (i) => Number(i.receivedQty || 0) + QTY_EPSILON >= Number(i.quantity || 0),
  );
  const anyReceived = items.some((i) => Number(i.receivedQty || 0) > 0);

  let newStatus = currentStatus;
  if (allReceived) newStatus = "Received";
  else if (anyReceived) newStatus = "PartiallyReceived";

  if (newStatus !== currentStatus) {
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: newStatus },
    });
  }
  return newStatus;
};

/**
 * Fetches + validates the source PO (rule 1). Returns null when the PO has no source.
 */
const loadSourcePo = async (po) => {
  const sourcePoId = po.source_po_id?.trim();
  if (!sourcePoId) return null;

  if (sourcePoId === po.id) {
    throw new AppError(400, "PO cannot be its own source PO.");
  }

  const sourcePo = await prisma.purchaseOrder.findUnique({
    where: { id: sourcePoId },
    include: { items: true },
  });

  if (!sourcePo) {
    throw new AppError(400, "Invalid source PO ID linked to this PO.");
  }
  if (sourcePo.status === "Cancelled") {
    throw new AppError(409, `Source PO ${sourcePo.poNumber} is cancelled.`);
  }
  if (!sourcePo.warehouseId) {
    throw new AppError(400, `Source PO ${sourcePo.poNumber} has no warehouse.`);
  }
  return sourcePo;
};

/**
 * Matches each received line with its item(s) in the source PO.
 */
const matchSourceItems = (lines, sourcePo) => {
  for (const l of lines) {
    if (l.goodQty <= 0) continue;

    const matches = sourcePo.items.filter(
      (s) => itemKey(s.itemSource, s.itemId) === itemKey(l.itemSource, l.itemId),
    );
    if (!matches.length) {
      throw new AppError(
        400,
        `${l.itemName} is not part of source PO ${sourcePo.poNumber}.`,
      );
    }
    if (matches.some((s) => normUnit(s.unit) !== l.poUnit)) {
      throw new AppError(
        400,
        `Unit of ${l.itemName} differs between this PO and source PO ${sourcePo.poNumber}.`,
      );
    }
    l.sourceItems = matches;
  }
};

/**
 * Rule 2 (same or different warehouse): goods arrive once, so receiving this
 * PO also auto-receives the source PO. Stock is increased only once, and only
 * in this (resale) PO's warehouse; the source warehouse's stock is never touched.
 *  - source still pending >= goodQty -> mark source received + add stock here
 *  - source already fully received   -> stock already counted, don't add again
 *  - partially pending                -> ask the user to split the receipt
 */
const planSourceReceive = (lines, sourcePo) => {
  for (const l of lines) {
    l.stockMode = STOCK_MODE.ADD;
    l.sourceAllocations = [];
    if (l.goodQty <= 0) continue;

    const pending = l.sourceItems.reduce(
      (sum, s) =>
        sum + Math.max(0, Number(s.quantity || 0) - Number(s.receivedQty || 0)),
      0,
    );

    if (pending <= QTY_EPSILON) {
      l.stockMode = STOCK_MODE.SKIP;
      continue;
    }

    if (pending + QTY_EPSILON < l.goodQty) {
      throw new AppError(
        409,
        `${l.itemName}: source PO ${sourcePo.poNumber} has only ${pending} pending (rest already received there). ` +
          `Receive ${pending} first, then the remaining quantity separately.`,
      );
    }

    let left = l.goodQty;
    for (const s of l.sourceItems) {
      if (left <= QTY_EPSILON) break;
      const free = Number(s.quantity || 0) - Number(s.receivedQty || 0);
      if (free <= QTY_EPSILON) continue;
      const qty = Math.min(free, left);
      l.sourceAllocations.push({ sourceItem: s, qty });
      left -= qty;
    }
  }
};

const purchaseOrderReceivingBill = async (req, res) => {
  const userId = req.user?.id;
  const warehouseId = String(req.user?.warehouseId);
  let uploadedFilePath = null;

  const deleteUploadedFile = async () => {
    if (!uploadedFilePath) return;
    try {
      await fs.unlink(uploadedFilePath);
    } catch (err) {
      console.error("⚠️ Failed to delete uploaded file:", err);
    }
  };

  try {
    // ================= FILE (set first so every failure path cleans up) =================
    const billFile = req.files?.billFile?.[0];
    if (!billFile) throw new AppError(400, "Bill file is required.");

    uploadedFilePath = path.join(
      __dirname,
      "../../../uploads/purchaseOrder/receivingBill",
      billFile.filename,
    );

    // ================= PARSE BODY =================
    let rawItems = req.body.items;
    if (typeof rawItems === "string") {
      try {
        rawItems = JSON.parse(rawItems);
      } catch {
        throw new AppError(400, "Invalid items JSON.");
      }
    }

    const { purchaseOrderId, invoiceNumber, vehicleNumber } = req.body;

    if (
      !purchaseOrderId ||
      !invoiceNumber ||
      !Array.isArray(rawItems) ||
      !rawItems.length
    ) {
      throw new AppError(
        400,
        "purchaseOrderId, invoiceNumber and items are required.",
      );
    }

    // ================= FETCH + CHECK PO =================
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });

    if (!po) throw new AppError(404, "Purchase Order not found.");

    if (String(po.warehouseId) !== warehouseId) {
      throw new AppError(403, "Unauthorized warehouse access.");
    }

    if (VEHICLE_REQUIRED_WAREHOUSES.has(po.warehouseName) && !vehicleNumber) {
      throw new AppError(
        400,
        `vehicleNumber is required for ${po.warehouseName}.`,
      );
    }

    if (["Cancelled", "Received"].includes(po.status)) {
      throw new AppError(409, `PO already ${po.status}.`);
    }

    // ================= VALIDATE + PREFETCH (all outside the transaction) =================
    const lines = await prepareItems(rawItems, po);
    for (const l of lines) l.stockMode = STOCK_MODE.ADD;

    // ================= SOURCE PO (resale) =================
    const sourcePo = await loadSourcePo(po); // rule 1
    if (sourcePo) {
      matchSourceItems(lines, sourcePo);
      planSourceReceive(lines, sourcePo); // rule 2 (same or different warehouse)
    }

    // ================= TRANSACTION (MySQL writes + Mongo last) =================
    const receiptResults = await prisma.$transaction(async (tx) => {
      // Re-check status inside the tx (guards against a concurrent receipt/cancel).
      const fresh = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: { status: true },
      });
      if (!fresh || ["Cancelled", "Received"].includes(fresh.status)) {
        throw new AppError(409, `PO already ${fresh?.status ?? "removed"}.`);
      }

      // 1. Bill
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

      // 2. Receipts (single insert)
      const receivedDate = new Date();
      await tx.purchaseOrderReceipt.createMany({
        data: lines.map((l) => ({
          purchaseOrderId,
          purchaseOrderItemId: l.purchaseOrderItemId,
          invoiceNumber,
          vehicleNumber: vehicleNumber || null,
          itemId: l.itemId,
          itemSource: l.itemSource,
          itemName: l.itemName,
          receivedQty: l.goodQty + l.damagedQty,
          goodQty: l.goodQty,
          damagedQty: l.damagedQty,
          remarks: l.remarks,
          createdBy: userId,
          receivedDate,
        })),
      });

      // 3. PO item receivedQty: atomic conditional increment (race-safe over-receive guard)
      for (const l of lines) {
        if (l.goodQty <= 0) continue;
        const { count } = await tx.purchaseOrderItem.updateMany({
          where: {
            id: l.purchaseOrderItemId,
            receivedQty: { lte: l.orderedQty - l.goodQty + QTY_EPSILON },
          },
          data: { receivedQty: { increment: l.goodQty } },
        });
        if (count !== 1) {
          throw new AppError(
            409,
            `Over receiving ${l.itemName} (PO was updated by someone else, please refresh).`,
          );
        }
      }

      // 3b. Rule 2: auto-receive the source PO too, whether its warehouse is the
      //     same or different (no stock change in the source warehouse).
      let sourceStatus = sourcePo?.status ?? null;
      if (sourcePo) {
        const allocations = lines.flatMap((l) =>
          (l.sourceAllocations || []).map((a) => ({ ...a, line: l })),
        );

        for (const a of allocations) {
          const ordered = Number(a.sourceItem.quantity || 0);
          const { count } = await tx.purchaseOrderItem.updateMany({
            where: {
              id: a.sourceItem.id,
              receivedQty: { lte: ordered - a.qty + QTY_EPSILON },
            },
            data: { receivedQty: { increment: a.qty } },
          });
          if (count !== 1) {
            throw new AppError(
              409,
              `Source PO ${sourcePo.poNumber} was updated by someone else for ${a.line.itemName}, please refresh.`,
            );
          }
        }

        if (allocations.length) {
          await tx.purchaseOrderReceipt.createMany({
            data: allocations.map((a) => ({
              purchaseOrderId: sourcePo.id,
              purchaseOrderItemId: a.sourceItem.id,
              invoiceNumber,
              vehicleNumber: vehicleNumber || null,
              itemId: a.line.itemId,
              itemSource: a.line.itemSource,
              itemName: a.line.itemName,
              receivedQty: a.qty,
              goodQty: a.qty,
              damagedQty: 0,
              remarks: `Auto-received via resale PO ${po.poNumber}`,
              createdBy: userId,
              receivedDate,
            })),
          });

          sourceStatus = await syncPoStatus(tx, sourcePo.id, sourcePo.status);
        }
      }

      // 4. Container-wise history (only for stock that is newly entering the system;
      //    SKIP lines were already counted via the source PO).
      const stockLines = lines.filter(
        (l) =>
          l.goodQty > 0 &&
          l.stockMode === STOCK_MODE.ADD &&
          Object.keys(l.stock).length,
      );
      if (stockLines.length) {
        const existing = await tx.item_container_wise_history.findMany({
          where: {
            item_id: { in: [...new Set(stockLines.map((l) => l.itemId))] },
            warehouse_id: warehouseId,
          },
        });
        const historyByItem = new Map();
        for (const h of existing) {
          if (!historyByItem.has(String(h.item_id))) {
            historyByItem.set(String(h.item_id), h);
          }
        }

        for (const l of stockLines) {
          const key = String(l.itemId);
          const current = historyByItem.get(key);

          if (current) {
            const merged = mergeContainerStock(
              current.stock_with_container,
              l.stock,
            );
            await tx.item_container_wise_history.update({
              where: { id: current.id },
              data: { stock_with_container: merged },
            });
            current.stock_with_container = merged;
          } else {
            const created = await tx.item_container_wise_history.create({
              data: {
                item_id: l.itemId,
                warehouse_id: warehouseId,
                stock_with_container: mergeContainerStock({}, l.stock),
              },
            });
            historyByItem.set(key, created);
          }
        }
      }

      // 5. Damaged stock (single insert)
      const damagedLines = lines.filter((l) => l.damagedQty > 0);
      if (damagedLines.length) {
        await tx.damagedStock.createMany({
          data: damagedLines.map((l) => ({
            purchaseOrderId,
            invoiceNumber,
            itemId: l.itemId,
            itemSource: l.itemSource,
            itemName: l.itemName,
            unit: l.poItem.unit,
            quantity: l.damagedQty,
            status: "Pending",
            remarks: l.remarks,
            createdBy: userId,
          })),
        });
      }

      // 6. MySQL warehouse stock
      for (const l of lines) {
        if (l.itemSource !== "mysql" || !addsStock(l)) continue;

        // Stock goes only into this (resale) PO's warehouse.
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_rawMaterialId: {
              warehouseId,
              rawMaterialId: l.rawMaterialId,
            },
          },
          update: { quantity: { increment: l.baseQty } },
          create: {
            warehouseId,
            rawMaterialId: l.rawMaterialId,
            quantity: l.baseQty,
            unit: l.baseUnit,
          },
        });
      }

      // 7. PO status
      await syncPoStatus(tx, purchaseOrderId, fresh.status);

      // 8. Mongo stock is NOT written here — see applyMongoStock (runs after commit).

      // 9. Audit log
      const results = lines.map((l) => ({
        itemId: l.itemId,
        itemName: l.itemName,
        goodQty: l.goodQty,
        damagedQty: l.damagedQty,
        remainingQty: l.orderedQty - l.totalReceived,
        stockMode: l.goodQty > 0 ? l.stockMode : null,
      }));

      const sourceInfo = sourcePo
        ? {
            sourcePoId: sourcePo.id,
            sourcePoNumber: sourcePo.poNumber,
            sourceWarehouseId: String(sourcePo.warehouseId),
            mode: "AUTO_RECEIVE_SOURCE",
            sourceStatus,
          }
        : null;

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: purchaseOrderId,
          action: "RECEIVE_PO",
          performedBy: userId,
          oldValue: po,
          newValue: { receiptResults: results, source: sourceInfo },
        },
      });

      return { items: results, source: sourceInfo };
    }, TX_OPTIONS);

    // MySQL committed — only now touch Mongo stock (never throws).
    const stockFailed = await applyMongoStock({
      warehouseId,
      lines: lines.filter((l) => l.itemSource === "mongo" && addsStock(l)),
      userId,
    });

    return receiptResponse(res, receiptResults, stockFailed);
  } catch (err) {
    console.error("❌ PO Receiving Error:", err);

    // Mongo is only written after commit, so nothing to undo there.
    await deleteUploadedFile();

    let status = 500;
    let message = "PO receiving failed.";

    if (err instanceof AppError) {
      status = err.status;
      message = err.message;
    } else if (err?.name === "CastError") {
      status = 400;
      message = "Invalid item id.";
    } else if (err?.code === "P2028") {
      status = 503;
      message = "Server is busy, please retry.";
    }

    return res.status(status).json({ success: false, message });
  }
};
 // ----------- Get Pending POs For Receiving ----------------//
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

    // 2️⃣ Item descriptions from MySQL (RawMaterial) + Mongo (SystemItem), one query each
    const descriptionMap = await getItemDescriptionMap(
      pos.flatMap((po) => po.items),
    );

    // 3️⃣ Filter POs + Items in JS
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
            itemDetail:item.itemDetail,
            description:
              descriptionMap.get(keyOf(item.itemSource, item.itemId)) ?? null,
            hsnCode: item.hsnCode,
            modelNumber: item.modelNumber,
            unit: item.unit,
            quantity: item.quantity,
            receivedQty: item.receivedQty,
            pendingQty:
              Number(item.quantity || 0) - Number(item.receivedQty || 0),
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


module.exports = {
  purchaseOrderReceivingBill,
  getPendingPOsForReceiving
};
