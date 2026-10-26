const multer = require('multer');
const path = require('path');
const fs = require('fs');

const getMulterStorage = (uploadPath) => {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const fullPath = path.join(__dirname, '../uploads', uploadPath);
      fs.mkdirSync(fullPath, { recursive: true });
      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname.split(".")[0]+"_"+Date.now() + path.extname(file.originalname));
    },
  });
};

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only images and PDFs allowed'), false);
  }
};

const dynamicMultipleUpload = (uploadPath, fieldName) => {
  return multer({
    storage: getMulterStorage(uploadPath),
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }).fields(
    Array.isArray(fieldName)
      ? fieldName.map(f => ({ name: f.name, maxCount: f.maxCount || 1 }))
      : [{ name: fieldName, maxCount: 5 }]
  );
};

module.exports = dynamicMultipleUpload;
 