/**
 * Systems that share their order quantity (inSystemOrder) with another system.
 *
 * Use this when a system is re-created only because its BOM changed, but the
 * orders and pumps are still the same. Installing with either system then
 * updates the same order quantity.
 *
 *   key   = systemId whose orders are redirected (the new BOM system)
 *   value = systemId that owns the orders       (the original system)
 *
 * BOM and stock are still read from the selected system. Only the
 * order lookups (inSystemOrder) are redirected.
 */
const SYSTEM_ORDER_MAP = {
  // 3HP DC System New  ->  3HP DC System
  "6b06b3830a5bddcb3a0f7b40": "68145a5dc633b11fd5905f74",
};

/**
 * Returns the systemId whose inSystemOrder rows should be used for `systemId`.
 * If there is no mapping, or the mapped id is not a 24-char hex id,
 * the same systemId is returned.
 */
const getOrderSystemId = (systemId) => {
  if (!systemId) return systemId;
  const mapped = SYSTEM_ORDER_MAP[String(systemId)];
  return mapped && /^[0-9a-fA-F]{24}$/.test(mapped) ? mapped : systemId;
};

module.exports = { SYSTEM_ORDER_MAP, getOrderSystemId };
