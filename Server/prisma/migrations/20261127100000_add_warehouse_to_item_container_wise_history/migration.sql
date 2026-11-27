-- AlterTable: container-wise stock is now tracked per (item, warehouse)
ALTER TABLE `item_container_wise_history` ADD COLUMN `warehouse_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `item_container_wise_history_item_id_warehouse_id_key` ON `item_container_wise_history`(`item_id`, `warehouse_id`);

-- CreateIndex
CREATE INDEX `item_container_wise_history_warehouse_id_idx` ON `item_container_wise_history`(`warehouse_id`);

-- AlterTable: containers now belong to a warehouse
ALTER TABLE `container_list` ADD COLUMN `warehouse_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `container_list_warehouse_id_name_key` ON `container_list`(`warehouse_id`, `name`);

-- CreateIndex
CREATE INDEX `container_list_warehouse_id_idx` ON `container_list`(`warehouse_id`);
