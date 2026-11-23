const multer = require("multer");
const fs = require("fs");
const path = require("path");

// Base folder
const BASE_UPLOAD_PATH = path.join(__dirname, "../../uploads/vendors");

// Create folders if not exist
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

// Storage Config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let uploadPath = BASE_UPLOAD_PATH;

    if (file.fieldname === "aadhaarFile") {
      uploadPath = path.join(uploadPath, "aadhaar");
    }
    if (file.fieldname === "pancardFile") {
      uploadPath = path.join(uploadPath, "pancard");
    }
    if (file.fieldname === "invoiceFile") {
      uploadPath = path.join(uploadPath, "invoices");
    }
    if (file.fieldname === "bgDocumentFile") {
      uploadPath = path.join(uploadPath, "bg-documents");
    }
    if (file.fieldname === "balanceSheetFile") {
      uploadPath = path.join(uploadPath, "balance-sheets");
    }

    ensureDirExists(uploadPath);
    cb(null, uploadPath);
  },

  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = Date.now().toString();
    const cleanField = file.fieldname.replace(/[^a-z0-9]/gi, "").toLowerCase();
    cb(null, `${cleanField}-${unique}${ext}`);
  },
});

// Allowed file types: JPG, PNG, PDF
const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "application/pdf"];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, and PDF files are allowed!"), false);
  }
  cb(null, true);
};

const uploadVendorDocs = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 3 * 1024 * 1024, // 3MB per file
  },
});

module.exports = uploadVendorDocs;
