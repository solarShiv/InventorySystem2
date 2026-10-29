-- CreateTable
CREATE TABLE `item_container_wise_history` (
    `id` VARCHAR(191) NOT NULL,
    `item_id` VARCHAR(191) NOT NULL,
    `stock_with_container` JSON NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;