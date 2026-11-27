const express = require("express");
const router = express.Router();
const userController = require("../../controllers/rawMaterialItemsController/userController");
const {
  tokenVerification,
} = require("../../middlewares/rawMaterialMiddlewares/tokenVerification");

router.put(
  "/password",
  tokenVerification([
    "Stamping",
    "SFG Work",
    "Accounts",
    "Winding Connection",
    "Store",
    "Assemble",
    "Admin",
    "Testing",
    "Production",
    "Others",
    "Winding",
    "Disassemble",
    "SuperAdmin",
    "Verification",
    "Infrastructure",
    "Purchase",
  ]),
  userController.updatePassword,
);

module.exports = router;
