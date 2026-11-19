const mongoose = require("mongoose");
const prisma = require("../config/prismaClient");
const SystemItem = require("../models/systemInventoryModels/systemItemSchema");

const keyOf = (itemSource, itemId) => `${itemSource}:${String(itemId)}`;

/**
 * Fetches descriptions for items that live in either MySQL (RawMaterial) or
 * MongoDB (SystemItem / inSystemItems). One query per DB, no matter how many items.
 *
 * @param {Array<{itemId: string, itemSource: "mysql"|"mongo"}>} items
 * @returns {Promise<Map<string, string|null>>} key = `${itemSource}:${itemId}`
 */
const getItemDescriptionMap = async (items = []) => {
  const mysqlIds = new Set();
  const mongoIds = new Set();

  for (const { itemId, itemSource } of items) {
    if (!itemId) continue;
    if (itemSource === "mysql") mysqlIds.add(String(itemId));
    else if (itemSource === "mongo" && mongoose.isValidObjectId(itemId)) {
      mongoIds.add(String(itemId));
    }
  }

  const [rawMaterials, systemItems] = await Promise.all([
    mysqlIds.size
      ? prisma.rawMaterial.findMany({
          where: { id: { in: [...mysqlIds] } },
          select: { id: true, description: true },
        })
      : [],
    mongoIds.size
      ? SystemItem.find({ _id: { $in: [...mongoIds] } })
          .select("_id description")
          .lean()
      : [],
  ]);

  const map = new Map();
  for (const r of rawMaterials) map.set(keyOf("mysql", r.id), r.description || null);
  for (const s of systemItems) map.set(keyOf("mongo", s._id), s.description || null);
  return map;
};

/**
 * Returns a copy of each item with a `description` field added.
 */
const attachItemDescriptions = async (items = []) => {
  const map = await getItemDescriptionMap(items);
  return items.map((item) => ({
    ...item,
    description: map.get(keyOf(item.itemSource, item.itemId)) ?? null,
  }));
};

module.exports = { getItemDescriptionMap, attachItemDescriptions, keyOf };
