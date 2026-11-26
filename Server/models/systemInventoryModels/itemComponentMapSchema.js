const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const itemComponentMapSchema = new Schema(
  {
    systemId: {
      type: Schema.Types.ObjectId,
      ref: "System",
      required: true,
    },
    systemItemId: {
      type: Schema.Types.ObjectId,
      ref: "SystemItem",
      required: true,
    },
    subItemId: {
      type: Schema.Types.ObjectId,
      ref: "SystemItem",
      required: true,
    },
    bomId: {
      type: Schema.Types.ObjectId,
      ref: "BOM",
      // required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    unit: {
      type: String,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { collection: "inItemComponentMap" },
);

const ItemComponentMap = mongoose.model(
  "ItemComponentMap",
  itemComponentMapSchema,
);
module.exports = ItemComponentMap;
