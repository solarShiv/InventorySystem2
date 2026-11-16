-- AlterTable
ALTER TABLE `PurchaseOrder` ADD COLUMN `source_po_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `PurchaseOrder_source_po_id_fkey` ON `PurchaseOrder`(`source_po_id`);

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_source_po_id_fkey` FOREIGN KEY (`source_po_id`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;