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
  if (!warehouseData) throw new Error("Warehouse not found");

  const systemData = await System.findById(systemId);
  if (!systemData) throw new Error("System not found");

  /* =====================================================
     STEP 1: SYSTEM ORDERS
  ===================================================== */
  // Orders may be shared with another system (see config/systemOrderMap.js)
  const systemOrders = await SystemOrder.find({
    warehouseId,
    systemId: getOrderSystemId(systemId),
  }).lean();

  const headWiseOrders = {};
  let totalDesired = 0;
  let unknownDesired = 0;

  systemOrders.forEach((order) => {
    const remainingOrder = Math.max(
      order.totalOrder - order.dispatchedOrder,
      0,
    );

    // SYSTEM ORDER (NO HEAD) → counts for entire system
    if (!order.pumpHead) {
      totalDesired += remainingOrder;
      return;
    }

    // UNKNOWN head
    if (order.pumpHead === "UNKNOWN") {
      unknownDesired += remainingOrder;
      totalDesired += remainingOrder;
      return;
    }

    // HEAD BASED ORDER
    headWiseOrders[order.pumpHead] = {
      pumpId: order.pumpId,
      remainingOrder,
    };

    totalDesired += remainingOrder;
  });
  /* =====================================================
     STEP 2: SYSTEM ITEMS
  ===================================================== */
  const systemItems = await SystemItemMap.find({ systemId })
    .populate("systemItemId", "itemName")
    .lean();

  const commonItems = [];
  const pumpItems = [];
  const systemSpecificItems = [];

  const itemComponents = await ItemComponentMap.find({ systemId })
    .populate("subItemId", "itemName")
    .lean();

  systemItems.forEach((item) => {
    if (!item.systemItemId) return;

    const itemName = item.systemItemId.itemName || "";
    const pumpHead = getPumpHead(itemName);

    // TRUE variable item
    if (pumpHead) {
      pumpItems.push({ ...item, pumpHead });
      return;
    }

    // Check if item belongs to pump assembly via component mapping
    const isPumpChild = itemComponents.some(
      (comp) =>
        comp.subItemId?._id.toString() === item.systemItemId._id.toString(),
    );

    if (isPumpChild) {
      // variable sub component
      pumpItems.push({ ...item, pumpHead: "COMPONENT" });
      return;
    }

    // IMPORTANT: system specific items MUST stay separate
    systemSpecificItems.push(item);
  });

  /* =====================================================
     STEP 4: INVENTORY (ACCUMULATED STOCK)
  ===================================================== */
  const inventoryItems = await InstallationInventory.find({ warehouseId })
    .populate("systemItemId", "itemName")
    .lean();

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
    const requiredQty = item.quantity * totalDesired;

    return {
      itemId: item.systemItemId._id,
      itemName: item.systemItemId.itemName,
      bomQty: item.quantity,
      stockQty,
      possibleSystem:
        item.quantity > 0 ? Math.floor(stockQty / item.quantity) : 0,
      requiredQty,
      shortageQty: Math.max(requiredQty - stockQty, 0),
    };
  });

  const commonPossible = commonItemsResponse.length
    ? Math.min(
        ...commonItemsResponse.map((i) =>
          i.bomQty > 0 ? Math.floor(i.stockQty / i.bomQty) : Infinity,
        ),
      )
    : 0;

  /* =====================================================
   STEP 5B: SYSTEM SPECIFIC ITEMS (IMPORTANT FIX)
===================================================== */

  const systemSpecificResponse = systemSpecificItems.map((item) => {
    const itemId = item.systemItemId._id.toString();
    const stockQty = inventoryMap.get(itemId) || 0;

    // IMPORTANT: use totalDesired of this system
    const requiredQty = item.quantity * totalDesired;

    return {
      itemId: item.systemItemId._id,
      itemName: item.systemItemId.itemName,
      bomQty: item.quantity,
      stockQty,
      possibleSystem:
        item.quantity > 0 ? Math.floor(stockQty / item.quantity) : 0,
      requiredQty,
      shortageQty: Math.max(requiredQty - stockQty, 0),
    };
  });

  /* =====================================================
     STEP 6: VARIABLE ITEMS
  ===================================================== */
  const variableItemsResponse = [];

  for (const pumpHead of Object.keys(headWiseOrders)) {
    const desiredSystems = headWiseOrders[pumpHead].remainingOrder;
    const pumpsForHead = pumpItems.filter((p) => p.pumpHead === pumpHead);
    const items = [];

    /* ---------- Pump items ---------- */
    pumpsForHead.forEach((pump) => {
      const pumpId = pump.systemItemId._id.toString();
      const stockQty = inventoryMap.get(pumpId) || 0;
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

    /* ---------- Sub-items (DEDUP FIX) ---------- */
    const addedSubItems = new Set();

    itemComponents
      .filter((comp) =>
        pumpsForHead.some(
          (p) => p.systemItemId._id.toString() === comp.systemItemId.toString(),
        ),
      )
      .forEach((comp) => {
        if (!comp.subItemId) return;

        const subItemId = comp.subItemId._id.toString();
        if (addedSubItems.has(subItemId)) return;
        addedSubItems.add(subItemId);

        const stockQty = inventoryMap.get(subItemId) || 0;
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

    const possibleSystems = items.length
      ? Math.min(
          ...items.map((i) =>
            i.bomQty > 0 ? Math.floor(i.stockQty / i.bomQty) : Infinity,
          ),
        )
      : 0;

    variableItemsResponse.push({
      pumpHead,
      desiredSystems,
      possibleSystems,
      items,
    });
  }

  /* =====================================================
     STEP 7: SUMMARY
  ===================================================== */
  const headWiseSystemSummary = {};

  variableItemsResponse.forEach((v) => {
    headWiseSystemSummary[v.pumpHead] = {
      desiredSystem: v.desiredSystems,
      possibleSystem: v.possibleSystems,
    };
  });

  if (unknownDesired > 0) {
    headWiseSystemSummary.UNKNOWN = {
      desiredSystem: unknownDesired,
      possibleSystem: 0,
    };
  }
  console.log(systemSpecificResponse);
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
    commonItems: [...commonItemsResponse, ...systemSpecificResponse],
    variableItems: variableItemsResponse,
  };
};
