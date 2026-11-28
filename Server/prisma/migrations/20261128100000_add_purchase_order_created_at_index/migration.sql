-- CreateIndex: speeds up PO list sorting (ORDER BY createdAt DESC)
CREATE INDEX `PurchaseOrder_createdAt_idx` ON `PurchaseOrder`(`createdAt`);
