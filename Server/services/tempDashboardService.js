const Warehouse = require("../models/serviceInventoryModels/warehouseSchema");
const System = require("../models/systemInventoryModels/systemSchema");
const SystemOrder = require("../models/systemInventoryModels/systemOrderSchema");
const SystemItemMap = require("../models/systemInventoryModels/systemItemMapSchema");
const ItemComponentMap = require("../models/systemInventoryModels/itemComponentMapSchema");
const InstallationInventory = require("../models/systemInventoryModels/installationInventorySchema");
const { getOrderSystemId } = require("../config/systemOrderMap");

const getPumpHead = (itemName = "") => {
  const heads = ["30M", "50M", "70M", "100M"];
  return heads.find((h) => itemName.includes(h)) || null;
};

module.exports = async (systemId, warehouseId) => {
  if (!systemId || !warehouseId) {
    throw new Error("systemId and warehouseId are required");
  }

  const warehouseData = await Warehouse.findById(warehouseId);
  if (!warehouseData) {
    throw new Error(`Warehouse not found.`);
  }

  const systemData = await System.findById(systemId);
  if (!systemData) {
    throw new Error(`System not found.`);
  }

  /* =====================================================
     STEP 1: SYSTEM ORDERS (HEAD-WISE DESIRED)
     (UNKNOWN → COMMON ONLY)
===================================================== */
  // Orders may be shared with another system (see config/systemOrderMap.js)
  const systemOrders = await SystemOrder.find({
    warehouseId,
    systemId: getOrderSystemId(systemId),
  }).lean();

  const headWiseOrders = {};
  let totalDesired = 0;
  let unknownDesired = 0; // ✅ NEW

  systemOrders.forEach((order) => {
    if (!order.pumpHead) return;

    const remainingOrder = Math.max(
      order.totalOrder - order.dispatchedOrder,
      0
    );

    // ✅ UNKNOWN → common system only
    if (order.pumpHead === "UNKNOWN") {
      unknownDesired += remainingOrder;
      totalDesired += remainingOrder;
      return;
    }

    headWiseOrders[order.pumpHead] = {
      pumpId: order.pumpId,
      totalOrder: order.totalOrder,
      dispatchedOrder: order.dispatchedOrder,
      remainingOrder,
    };

    totalDesired += remainingOrder;
  });

  /* =====================================================
       STEP 2: SYSTEM ITEMS (COMMON + PUMPS)
    ===================================================== */
  const systemItems = await SystemItemMap.find({ systemId })
    .populate("systemItemId", "itemName")
    .lean();

  const commonItems = [];
  const pumpItems = [];

  systemItems.forEach((item) => {
    if (!item.systemItemId) return; // 🔒 NULL SAFE

    const pumpHead = getPumpHead(item.systemItemId.itemName);

    if (pumpHead) {
      pumpItems.push({ ...item, pumpHead });
    } else {
      commonItems.push(item);
    }
  });

  /* =====================================================
       STEP 3: ITEM COMPONENT MAP (SUB-ITEMS)
    ===================================================== */
  const itemComponentsRaw = await ItemComponentMap.find({ systemId })
    .populate("subItemId", "itemName")
    .lean();

  // filter broken refs
  const itemComponents = itemComponentsRaw.filter(
    (c) => c.systemItemId && c.subItemId
  );

  /* =====================================================
       STEP 4: INVENTORY (WAREHOUSE)
    ===================================================== */
  const inventoryItems = await InstallationInventory.find({ warehouseId })
    .populate("systemItemId", "itemName")
    .lean();

  const inventoryMap = new Map();

  inventoryItems.forEach((item) => {
    if (!item.systemItemId) return; // 🔒 NULL SAFE

    inventoryMap.set(item.systemItemId._id.toString(), item.quantity);
  });

  /* =====================================================
       STEP 5: COMMON ITEMS
    ===================================================== */
  const commonItemsResponse = commonItems.map((item) => {
    const itemId = item.systemItemId?._id?.toString();
    const stockQty = itemId ? inventoryMap.get(itemId) || 0 : 0;
    const possibleSystem =
      item.quantity > 0 ? Math.floor(stockQty / item.quantity) : 0;
    const requiredQty = item.quantity * totalDesired;

    return {
      itemId: item.systemItemId._id,
      itemName: item.systemItemId.itemName,
      bomQty: item.quantity,
      stockQty,
      possibleSystem,
      requiredQty,
      shortageQty: Math.max(requiredQty - stockQty, 0),
    };
  });

  /* =====================================================
       STEP 6: COMMON POSSIBLE
    ===================================================== */

  const commonPossible = commonItemsResponse.length
    ? Math.min(
        ...commonItemsResponse.map((i) =>
          i.bomQty > 0 ? Math.floor(i.stockQty / i.bomQty) : Infinity
        )
      )
    : 0;

  /* =====================================================
       STEP 7: VARIABLE ITEMS (HEAD-WISE)
    ===================================================== */
  const variableItemsResponse = [];

  for (const pumpHead of Object.keys(headWiseOrders)) {
    const desiredSystems = headWiseOrders[pumpHead].remainingOrder;

    const pumpsForHead = pumpItems.filter((p) => p.pumpHead === pumpHead);

    const items = [];

    /* ---------- Pump item ---------- */
    pumpsForHead.forEach((pump) => {
      const pumpItemId = pump.systemItemId?._id?.toString();
      const stockQty = pumpItemId ? inventoryMap.get(pumpItemId) || 0 : 0;
      const requiredQty = pump.quantity * desiredSystems;

      items.push({
        itemId: pump.systemItemId._id,
        itemName: pump.systemItemId.itemName,
        bomQty: pump.quantity,
        stockQty,
        possibleSystem:
          pump.quantity > 0 ? Math.floor(stockQty / pump.quantity) : 0,
        requiredQty,
        shortageQty: Math.max(requiredQty - stockQty, 0),
      });
    });

    /* ---------- Sub-items ---------- */
    itemComponents
      .filter((comp) =>
        pumpsForHead.some(
          (p) => p.systemItemId._id.toString() === comp.systemItemId.toString()
        )
      )
      .forEach((comp) => {
        const subItemId = comp.subItemId?._id?.toString();
        const stockQty = subItemId ? inventoryMap.get(subItemId) || 0 : 0;

        const requiredQty = comp.quantity * desiredSystems;

        items.push({
          itemId: comp.subItemId._id,
          itemName: comp.subItemId.itemName,
          bomQty: comp.quantity,
          stockQty,
          possibleSystem:
            comp.quantity > 0 ? Math.floor(stockQty / comp.quantity) : 0,
          requiredQty,
          shortageQty: Math.max(requiredQty - stockQty, 0),
        });
      });

    /* ---------- VARIABLE POSSIBLE ---------- */
    const variablePossible = items.length
      ? Math.min(
          ...items.map((i) =>
            i.bomQty > 0 ? Math.floor(i.stockQty / i.bomQty) : Infinity
          )
        )
      : 0;

    /* ---------- FINAL POSSIBLE ---------- */
    const possibleSystems = variablePossible;

    variableItemsResponse.push({
      pumpHead,
      desiredSystems,
      possibleSystems,
      items,
    });
  }

  const headWiseSystemSummary = {};

  variableItemsResponse.forEach((v) => {
    headWiseSystemSummary[v.pumpHead] = {
      desiredSystem: v.desiredSystems,
      possibleSystem: v.possibleSystems,
    };
  });

  // ✅ ADD UNKNOWN VISIBILITY (NO IMPACT ON LOGIC)
  if (unknownDesired > 0) {
    headWiseSystemSummary.UNKNOWN = {
      desiredSystem: unknownDesired,
      possibleSystem: 0,
    };
  }

  return {
    warehouse: warehouseData.warehouseName,
    system: systemData.systemName,
    summary: {
      motorCommonSystem: {
        totalDesired,
        possibleSystem: commonPossible,
      },
      headWiseSystem: headWiseSystemSummary,
    },
    commonItems: commonItemsResponse,
    variableItems: variableItemsResponse,
  };
};