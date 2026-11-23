-- AlterTable
ALTER TABLE `Vendor` ADD COLUMN `authorization_status` ENUM('White', 'Gray', 'Red', 'Black') NULL DEFAULT 'White',
    ADD COLUMN `balance_sheet` VARCHAR(191) NULL,
    ADD COLUMN `bg_document` VARCHAR(191) NULL,
    ADD COLUMN `buy_item_category` ENUM('Long', 'Float') NULL,
    ADD COLUMN `category` ENUM('Manufacture', 'Trader') NULL;
