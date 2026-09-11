const crypto = require("crypto");

const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: "API key is required",
    });
  }

  const expectedKey = process.env.THIRD_PARTY_API_KEY;

  if (
    !expectedKey ||
    apiKey.length !== expectedKey.length ||
    !crypto.timingSafeEqual(
      Buffer.from(apiKey),
      Buffer.from(expectedKey)
    )
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid API key",
    });
  }

  next();
};

module.exports = verifyApiKey;