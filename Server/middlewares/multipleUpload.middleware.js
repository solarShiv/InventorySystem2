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
      // URL-safe name: spaces/special chars -> "_" (e.g. "My Photo.png" -> "My_Photo_1712345678.png")
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100) || 'file';
      cb(null, `${base}_${Date.now()}${ext}`);
    },
  });
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB (images / PDFs)
const MAX_VIDEO_SIZE = 5 * 1024 * 1024; // 5MB (videos)

const isVideo = (file) => file.mimetype.startsWith('video/');

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith('image/') ||
    file.mimetype === 'application/pdf' ||
    isVideo(file)
  ) {
    cb(null, true);
  } else {
    cb(new Error('Only images, PDFs and videos allowed'), false);
  }
};

const removeUploadedFiles = (files) => {
  for (const file of Object.values(files || {}).flat()) {
    fs.unlink(file.path, () => {});
  }
};

const dynamicMultipleUpload = (uploadPath, fieldName) => {
  const upload = multer({
    storage: getMulterStorage(uploadPath),
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE },
  }).fields(
    Array.isArray(fieldName)
      ? fieldName.map(f => ({ name: f.name, maxCount: f.maxCount || 1 }))
      : [{ name: fieldName, maxCount: 5 }]
  );

  // Multer has a single size limit, so videos are checked after upload
  // and the whole request is rejected (and its files deleted) if one is too big.
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) {
        // No global error handler exists, so answer with JSON here.
        removeUploadedFiles(req.files);
        let message = err.message;
        if (err.code === 'LIMIT_FILE_SIZE') message = 'File too large! Must be under 10MB.';
        else if (err.code === 'LIMIT_UNEXPECTED_FILE') message = `Unexpected file field "${err.field}" or too many files.`;
        return res.status(400).json({ success: false, message });
      }

      const tooBig = Object.values(req.files || {})
        .flat()
        .find((file) => isVideo(file) && file.size > MAX_VIDEO_SIZE);

      if (tooBig) {
        removeUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: `Video "${tooBig.originalname}" exceeds the 5MB limit.`,
        });
      }

      next();
    });
  };
};

module.exports = dynamicMultipleUpload;
 