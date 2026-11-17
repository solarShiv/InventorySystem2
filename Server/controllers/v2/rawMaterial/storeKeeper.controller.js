const prisma = require("../../../config/prismaClient");
const fs = require("fs/promises");
const path = require("path");
const InstallationInventory = require("../../../models/systemInventoryModels/installationInventorySchema");
const { default: mongoose } = require("mongoose");
const {
  AppError,
  prepareItems,
  mergeContainerStock,
  rollbackMongo,
} = require("../../rawMaterialItemsController/storekeeperController");

const QTY_EPSILON = 0.0001;
const VEHICLE_REQUIRED_WAREHOUSES = new Set(["Bhiwani", "Malanpur Warehouse"]);
const TX_OPTIONS = { maxWait: 10000, timeout: 30000 };

// How a received line affects warehouse stock.
//  "add"      -> normal receipt: increase stock of the receiving warehouse
//  "skip"     -> same-warehouse resale whose goods were already counted via the source PO
//  "transfer" -> different-warehouse resale: decrease source warehouse, increase receiving warehouse
const STOCK_MODE = { ADD: "add", SKIP: "skip", TRANSFER: "transfer" };

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
 * Rule 2: same warehouse. Goods arrive once, so receiving this PO also receives
 * the source PO, and stock is increased only once.
 *  - source still pending >= goodQty -> mark source received + add stock once
 *  - source already fully received   -> stock already counted, don't add again
 *  - partially pending                -> ask the user to split the receipt
 */
const planSameWarehouse = (lines, sourcePo) => {
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

/**
 * Rule 3: different warehouse. Each item may only be received up to what the
 * source PO has actually received, minus what other resale POs (in other
 * warehouses) already pulled from it. Runs inside the transaction.
 */
const checkTransferAvailability = async (tx, lines, sourcePo) => {
  const transferred = await tx.purchaseOrderItem.findMany({
    where: {
      purchaseOrder: {
        source_po_id: sourcePo.id,
        warehouseId: { not: sourcePo.warehouseId },
        status: { not: "Cancelled" },
      },
    },
    select: { itemId: true, itemSource: true, receivedQty: true },
  });

  const consumedByItem = new Map();
  for (const t of transferred) {
    const k = itemKey(t.itemSource, t.itemId);
    consumedByItem.set(k, (consumedByItem.get(k) || 0) + Number(t.receivedQty || 0));
  }

  // Fresh source receivedQty (inside tx)
  const freshSourceItems = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: sourcePo.id },
    select: { itemId: true, itemSource: true, receivedQty: true },
  });
  const sourceReceivedByItem = new Map();
  for (const s of freshSourceItems) {
    const k = itemKey(s.itemSource, s.itemId);
    sourceReceivedByItem.set(k, (sourceReceivedByItem.get(k) || 0) + Number(s.receivedQty || 0));
  }

  for (const l of lines) {
    if (l.goodQty <= 0) continue;
    const k = itemKey(l.itemSource, l.itemId);
    const received = sourceReceivedByItem.get(k) || 0;
    const consumed = consumedByItem.get(k) || 0;
    const available = received - consumed;

    if (l.goodQty > available + QTY_EPSILON) {
      throw new AppError(
        409,
        received <= QTY_EPSILON
          ? `${l.itemName} is not yet received in source PO ${sourcePo.poNumber}. Receive it there first.`
          : `${l.itemName}: only ${Math.max(0, available)} available from source PO ${sourcePo.poNumber} ` +
              `(received ${received}, already transferred ${consumed}).`,
      );
    }
  }
};

const purchaseOrderReceivingBill = async (req, res) => {
  const userId = req.user?.id;
  const warehouseId = String(req.user?.warehouseId);
  const mongoRollbackStack = [];
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
    const sameWarehouse =
      !!sourcePo && String(sourcePo.warehouseId) === String(po.warehouseId);
    const sourceWarehouseId = sourcePo ? String(sourcePo.warehouseId) : null;

    if (sourcePo) {
      matchSourceItems(lines, sourcePo);

      if (sameWarehouse) {
        planSameWarehouse(lines, sourcePo); // rule 2
      } else {
        // rule 3
        for (const l of lines) {
          if (l.goodQty > 0) l.stockMode = STOCK_MODE.TRANSFER;
        }
        if (
          lines.some((l) => l.itemSource === "mongo" && l.goodQty > 0) &&
          !mongoose.isValidObjectId(sourceWarehouseId)
        ) {
          throw new AppError(400, `Invalid warehouse on source PO ${sourcePo.poNumber}.`);
        }
      }
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

      // Rule 3: source must have received enough of each item (checked inside tx).
      if (sourcePo && !sameWarehouse) {
        await checkTransferAvailability(tx, lines, sourcePo);
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

      // 3b. Rule 2: same warehouse -> receive the source PO too (no extra stock).
      let sourceStatus = sourcePo?.status ?? null;
      if (sourcePo && sameWarehouse) {
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
      //    a transfer between warehouses doesn't change the item's total).
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

        // Rule 3: take the stock out of the source warehouse first.
        if (l.stockMode === STOCK_MODE.TRANSFER) {
          const { count } = await tx.warehouseStock.updateMany({
            where: {
              warehouseId: sourceWarehouseId,
              rawMaterialId: l.rawMaterialId,
              quantity: { gte: l.baseQty - QTY_EPSILON },
            },
            data: { quantity: { decrement: l.baseQty } },
          });
          if (count !== 1) {
            throw new AppError(
              409,
              `Insufficient stock of ${l.itemName} in source warehouse (${sourcePo.warehouseName || sourceWarehouseId}).`,
            );
          }
        }

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

      // 8. Mongo stock LAST: atomic $inc. If anything below this (or the commit)
      //    fails, the catch block compensates using mongoRollbackStack.
      for (const l of lines) {
        if (l.itemSource !== "mongo" || !addsStock(l)) continue;

        // Rule 3: decrease source warehouse (only if it has enough).
        if (l.stockMode === STOCK_MODE.TRANSFER) {
          const decremented = await InstallationInventory.findOneAndUpdate(
            {
              warehouseId: sourceWarehouseId,
              systemItemId: l.itemId,
              quantity: { $gte: l.baseQty - QTY_EPSILON },
            },
            {
              $inc: { quantity: -l.baseQty },
              $set: { updatedAt: new Date(), updatedByEmpId: userId },
            },
            { new: false },
          );
          if (!decremented) {
            throw new AppError(
              409,
              `Insufficient stock of ${l.itemName} in source warehouse (${sourcePo.warehouseName || sourceWarehouseId}).`,
            );
          }
          // rollbackMongo does $inc: -qty, so a negative qty restores the stock.
          mongoRollbackStack.push({
            warehouseId: sourceWarehouseId,
            systemItemId: l.itemId,
            qty: -l.baseQty,
            created: false,
          });
        }

        const before = await InstallationInventory.findOneAndUpdate(
          { warehouseId, systemItemId: l.itemId },
          {
            $inc: { quantity: l.baseQty },
            $set: { updatedAt: new Date(), updatedByEmpId: userId },
          },
          { upsert: true, new: false },
        );

        mongoRollbackStack.push({
          warehouseId,
          systemItemId: l.itemId,
          qty: l.baseQty,
          created: !before,
        });
      }

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
            sourceWarehouseId,
            mode: sameWarehouse ? "SAME_WAREHOUSE" : "WAREHOUSE_TRANSFER",
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

    return res.status(200).json({
      success: true,
      message: "Purchase Order received successfully.",
      data: receiptResults,
    });
  } catch (err) {
    console.error("❌ PO Receiving Error:", err);

    // MySQL is already rolled back by Prisma; undo any Mongo writes that happened.
    if (mongoRollbackStack.length) await rollbackMongo(mongoRollbackStack);
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

module.exports = {
  purchaseOrderReceivingBill,
};
