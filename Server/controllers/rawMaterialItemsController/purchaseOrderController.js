const prisma = require("../../config/prismaClient");
const Decimal = require("decimal.js");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const xlsx = require("xlsx");
const SystemItem = require("../../models/systemInventoryModels/systemItemSchema");
const InstallationInventory = require("../../models/systemInventoryModels/installationInventorySchema");
const generatePO = require("../../util/generatePO");
const poGenerate = require("../../util/poGenerate");
const debitNoteGenerate = require("../../util/debitNoteGenerate");
const Warehouse = require("../../models/serviceInventoryModels/warehouseSchema");
const System = require("../../models/systemInventoryModels/systemSchema");
const SystemOrder = require("../../models/systemInventoryModels/systemOrderSchema");
const ItemComponentMap = require("../../models/systemInventoryModels/itemComponentMapSchema");
const SystemItemMap = require("../../models/systemInventoryModels/systemItemMapSchema");
const BOM = require("../../models/systemInventoryModels/bomModelSchema");
const getDashboardService = require("../../services/systemDashboardService");
const buildPOPdfBuffer = require("../../helpers/rawMaterialItemsHelpers/poPdf.helper");
const sendPOMail = require("../../util/mail/sendPOMail");
const companyShortName = require("../../util/companyShortName");
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const logger = require("../../util/error/logger");

function getISTDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  // IST = UTC + 5 hours 30 minutes
  return new Date(utc + 5.5 * 60 * 60 * 1000);
}

function getFinancialYear(date = getISTDate()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // Jan = 1
  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;
  return `${startYear.toString().slice(-2)}${endYear.toString().slice(-2)}`;
}

const STATE_CODE_MAP = {
  "andhra pradesh": "AP",
  "arunachal pradesh": "AR",
  assam: "AS",
  bihar: "BR",
  chhattisgarh: "CG",
  goa: "GA",
  gujarat: "GJ",
  haryana: "HR",
  "himachal pradesh": "HP",
  jharkhand: "JH",
  karnataka: "KA",
  kerala: "KL",
  "madhya pradesh": "MP",
  maharashtra: "MH",
  manipur: "MN",
  meghalaya: "ML",
  mizoram: "MZ",
  nagaland: "NL",
  odisha: "OD",
  punjab: "PB",
  rajasthan: "RJ",
  sikkim: "SK",
  "tamil nadu": "TN",
  telangana: "TS",
  tripura: "TR",
  "uttar pradesh": "UP",
  uttarakhand: "UK",
  "west bengal": "WB",
  "andaman and nicobar islands": "AN",
  chandigarh: "CH",
  "dadra and nagar haveli and daman and diu": "DN",
  delhi: "DL",
  "jammu and kashmir": "JK",
  ladakh: "LA",
  lakshadweep: "LD",
  puducherry: "PY",
};

function getStateCode(stateName) {
  if (!stateName) return "XX";

  const input = stateName.toLowerCase().trim();

  for (const [state, code] of Object.entries(STATE_CODE_MAP)) {
    if (input.includes(state)) {
      return code;
    }
  }

  return input.substring(0, 2).toUpperCase();
}

async function generatePONumber(company) {
  const fy = getFinancialYear();
  const stateCode = getStateCode(company.state);
  console.log(stateCode);
  const prefix = `${company.companyCode}${stateCode}`;
  const counterKey = `${company.id}_${fy}`;

  const counter = await prisma.counter.upsert({
    where: { name: counterKey },
    update: { seq: { increment: 1 } },
    create: {
      name: counterKey,
      companyId: company.id,
      financialYear: fy,
      seq: 1,
    },
  });

  const nextSeq = counter.seq.toString().padStart(4, "0");
  return `${prefix}${fy}${nextSeq}`;
}

async function generateDebitNoteNumber(company) {
  const fy = getFinancialYear(); // e.g. "2024-2025"
  const stateCode = getStateCode(company.state);
  const prefix = `${company.companyCode}${stateCode}`;
  const counterName = `DN_${company.id}_${fy}`;

  const counter = await prisma.counter.upsert({
    where: { name: counterName },
    update: { seq: { increment: 1 } },
    create: {
      name: counterName,
      companyId: company.id,
      financialYear: fy,
      seq: 1,
    },
  });

  const nextSeq = counter.seq.toString().padStart(4, "0");
  return `${prefix}-DN-${fy}-${nextSeq}`;
}

const createCompany = async (req, res) => {
  try {
    const {
      name,
      companyCode,
      gstNumber,
      address,
      city,
      state,
      pincode,
      country,
      contactNumber,
      alternateNumber,
      email,
      currency,
    } = req.body;

    const performedBy = req.user?.id;

    if (
      !name ||
      !companyCode ||
      !gstNumber ||
      !address ||
      !contactNumber ||
      !email
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Company name, code, gstNumber, address, contact number, and email are required.",
      });
    }

    const trimmedName = name.trim();
    const upperCaseGST = gstNumber.toUpperCase().trim();
    const trimmedAddress = address.trim();
    const lowerCaseEmail = email.toLowerCase().trim();
    const trimmedCompanyCode = companyCode.toUpperCase().trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lowerCaseEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format.",
      });
    }

    // const existingCompany = await prisma.company.findFirst({
    //   where: { gstNumber: upperCaseGST },
    // });
    // if (existingCompany) {
    //   return res.status(400).json({
    //     success: false,
    //     message: `A company with GST number '${upperCaseGST}' already exists.`,
    //   });
    // }

    const allowedCountries = [
      "AFGHANISTAN",
      "ALBANIA",
      "ALGERIA",
      "ANDORRA",
      "ANGOLA",
      "ANTIGUA AND BARBUDA",
      "ARGENTINA",
      "ARMENIA",
      "AUSTRALIA",
      "AUSTRIA",
      "AZERBAIJAN",
      "BAHAMAS",
      "BAHRAIN",
      "BANGLADESH",
      "BARBADOS",
      "BELARUS",
      "BELGIUM",
      "BELIZE",
      "BENIN",
      "BHUTAN",
      "BOLIVIA",
      "BOSNIA AND HERZEGOVINA",
      "BOTSWANA",
      "BRAZIL",
      "BRUNEI",
      "BULGARIA",
      "BURKINA FASO",
      "BURUNDI",
      "CAMBODIA",
      "CAMEROON",
      "CANADA",
      "CAPE VERDE",
      "CENTRAL AFRICAN REPUBLIC",
      "CHAD",
      "CHILE",
      "CHINA",
      "COLOMBIA",
      "COMOROS",
      "CONGO",
      "COSTA RICA",
      "CROATIA",
      "CUBA",
      "CYPRUS",
      "CZECH REPUBLIC",
      "DENMARK",
      "DJIBOUTI",
      "DOMINICA",
      "DOMINICAN REPUBLIC",
      "ECUADOR",
      "EGYPT",
      "EL SALVADOR",
      "ERITREA",
      "ESTONIA",
      "ESWATINI",
      "ETHIOPIA",
      "FIJI",
      "FINLAND",
      "FRANCE",
      "GABON",
      "GAMBIA",
      "GEORGIA",
      "GERMANY",
      "GHANA",
      "GREECE",
      "GRENADA",
      "GUATEMALA",
      "GUINEA",
      "GUINEA-BISSAU",
      "GUYANA",
      "HAITI",
      "HONDURAS",
      "HONG KONG",
      "HUNGARY",
      "ICELAND",
      "INDIA",
      "INDONESIA",
      "IRAN",
      "IRAQ",
      "IRELAND",
      "ISRAEL",
      "ITALY",
      "JAMAICA",
      "JAPAN",
      "JORDAN",
      "KAZAKHSTAN",
      "KENYA",
      "KUWAIT",
      "KYRGYZSTAN",
      "LAOS",
      "LATVIA",
      "LEBANON",
      "LESOTHO",
      "LIBERIA",
      "LIBYA",
      "LIECHTENSTEIN",
      "LITHUANIA",
      "LUXEMBOURG",
      "MADAGASCAR",
      "MALAWI",
      "MALAYSIA",
      "MALDIVES",
      "MALI",
      "MALTA",
      "MAURITIUS",
      "MEXICO",
      "MOLDOVA",
      "MONACO",
      "MONGOLIA",
      "MONTENEGRO",
      "MOROCCO",
      "MOZAMBIQUE",
      "MYANMAR",
      "NAMIBIA",
      "NEPAL",
      "NETHERLANDS",
      "NEW ZEALAND",
      "NICARAGUA",
      "NIGER",
      "NIGERIA",
      "NORTH KOREA",
      "NORWAY",
      "OMAN",
      "PAKISTAN",
      "PALAU",
      "PANAMA",
      "PAPUA NEW GUINEA",
      "PARAGUAY",
      "PERU",
      "PHILIPPINES",
      "POLAND",
      "PORTUGAL",
      "QATAR",
      "ROMANIA",
      "RUSSIA",
      "RWANDA",
      "SAUDI ARABIA",
      "SENEGAL",
      "SERBIA",
      "SEYCHELLES",
      "SIERRA LEONE",
      "SINGAPORE",
      "SLOVAKIA",
      "SLOVENIA",
      "SOMALIA",
      "SOUTH AFRICA",
      "SOUTH KOREA",
      "SPAIN",
      "SRI LANKA",
      "SUDAN",
      "SURINAME",
      "SWEDEN",
      "SWITZERLAND",
      "SYRIA",
      "TAIWAN",
      "TAJIKISTAN",
      "TANZANIA",
      "THAILAND",
      "TOGO",
      "TRINIDAD AND TOBAGO",
      "TUNISIA",
      "TURKEY",
      "UGANDA",
      "UKRAINE",
      "UNITED ARAB EMIRATES",
      "UNITED KINGDOM",
      "UNITED STATES",
      "URUGUAY",
      "UZBEKISTAN",
      "VATICAN CITY",
      "VENEZUELA",
      "VIETNAM",
      "YEMEN",
      "ZAMBIA",
      "ZIMBABWE",
    ];

    const allowedCurrencies = [
      "AED",
      "AFN",
      "ALL",
      "AMD",
      "AOA",
      "ARS",
      "AUD",
      "AZN",
      "BAM",
      "BBD",
      "BDT",
      "BHD",
      "BIF",
      "BMD",
      "BND",
      "BOB",
      "BRL",
      "BSD",
      "BTN",
      "BWP",
      "BYN",
      "CAD",
      "CDF",
      "CHF",
      "CLP",
      "CNY",
      "COP",
      "CRC",
      "CUP",
      "CVE",
      "CZK",
      "DJF",
      "DKK",
      "DOP",
      "DZD",
      "EGP",
      "ERN",
      "ETB",
      "EUR",
      "FJD",
      "GBP",
      "GEL",
      "GHS",
      "GMD",
      "GNF",
      "GTQ",
      "GYD",
      "HKD",
      "HNL",
      "HTG",
      "HUF",
      "IDR",
      "ILS",
      "INR",
      "IQD",
      "IRR",
      "ISK",
      "JMD",
      "JOD",
      "JPY",
      "KES",
      "KGS",
      "KHR",
      "KMF",
      "KPW",
      "KRW",
      "KWD",
      "KZT",
      "LAK",
      "LBP",
      "LKR",
      "LRD",
      "LSL",
      "LYD",
      "MAD",
      "MDL",
      "MGA",
      "MMK",
      "MNT",
      "MOP",
      "MRU",
      "MUR",
      "MVR",
      "MWK",
      "MXN",
      "MYR",
      "MZN",
      "NAD",
      "NGN",
      "NIO",
      "NOK",
      "NPR",
      "NZD",
      "OMR",
      "PAB",
      "PEN",
      "PGK",
      "PHP",
      "PKR",
      "PLN",
      "PYG",
      "QAR",
      "RON",
      "RSD",
      "RUB",
      "RWF",
      "SAR",
      "SCR",
      "SDG",
      "SEK",
      "SGD",
      "SLL",
      "SOS",
      "SRD",
      "SSP",
      "STN",
      "SYP",
      "SZL",
      "THB",
      "TJS",
      "TMT",
      "TND",
      "TOP",
      "TRY",
      "TTD",
      "TWD",
      "TZS",
      "UAH",
      "UGX",
      "USD",
      "UYU",
      "UZS",
      "VES",
      "VND",
      "VUV",
      "WST",
      "XAF",
      "XCD",
      "XOF",
      "XPF",
      "YER",
      "ZAR",
      "ZMW",
      "ZWL",
    ];

    if (country && !allowedCountries.includes(country)) {
      return res.status(400).json({
        success: false,
        message: `Invalid country. Allowed: ${allowedCountries.join(", ")}`,
      });
    }

    if (currency && !allowedCurrencies.includes(currency)) {
      return res.status(400).json({
        success: false,
        message: `Invalid currency. Allowed: ${allowedCurrencies.join(", ")}`,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const newCompany = await tx.company.create({
        data: {
          name: trimmedName,
          companyCode: trimmedCompanyCode,
          gstNumber: upperCaseGST,
          address: trimmedAddress,
          city,
          state,
          pincode,
          contactNumber,
          alternateNumber,
          email: lowerCaseEmail,
          country: country || "INDIA",
          currency: currency || "INR",
          createdBy: performedBy,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "Company",
          entityId: newCompany.id,
          action: "Created",
          performedBy,
          newValue: newCompany,
        },
      });

      return newCompany;
    });

    return res.status(201).json({
      success: true,
      message: "Company created successfully.",
      data: result,
    });
  } catch (error) {
    console.error("❌ Error in createCompany:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const createVendor2 = async (req, res) => {
  try {
    const {
      name,
      email,
      gstNumber,
      address,
      city,
      state,
      pincode,
      country,
      currency,
      exchangeRate,
      contactPerson,
      contactNumber,
      zipCode,
    } = req.body;

    const performedBy = req.user?.id;

    if (
      !name ||
      !address ||
      !contactPerson ||
      !contactNumber ||
      !country ||
      !currency
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    if (country === "INDIA") {
      const trimmed = contactNumber.trim();
      if (!/^\d{10}$/.test(trimmed)) {
        return res.status(400).json({
          success: false,
          message: `Selected country: ${country}, contact number must be 10 digits without space.`,
        });
      }
    }

    const upperCaseName = name.trim();
    const upperCaseGST = gstNumber ? gstNumber.toUpperCase().trim() : null;
    const upperCaseAddress = address.trim();
    const lowerCaseEmail = email ? email.toLowerCase().trim() : null;

    // const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // if (!emailRegex.test(lowerCaseEmail)) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Invalid email format.",
    //   });
    // }
    if (upperCaseGST) {
      const existingVendor = await prisma.vendor.findFirst({
        where: { gstNumber: upperCaseGST },
      });
      if (existingVendor) {
        return res.status(400).json({
          success: false,
          message: `A vendor with GST number '${upperCaseGST}' already exists.`,
        });
      }
    }

    const allowedCountries = [
      "AFGHANISTAN",
      "ALBANIA",
      "ALGERIA",
      "ANDORRA",
      "ANGOLA",
      "ANTIGUA AND BARBUDA",
      "ARGENTINA",
      "ARMENIA",
      "AUSTRALIA",
      "AUSTRIA",
      "AZERBAIJAN",
      "BAHAMAS",
      "BAHRAIN",
      "BANGLADESH",
      "BARBADOS",
      "BELARUS",
      "BELGIUM",
      "BELIZE",
      "BENIN",
      "BHUTAN",
      "BOLIVIA",
      "BOSNIA AND HERZEGOVINA",
      "BOTSWANA",
      "BRAZIL",
      "BRUNEI",
      "BULGARIA",
      "BURKINA FASO",
      "BURUNDI",
      "CAMBODIA",
      "CAMEROON",
      "CANADA",
      "CAPE VERDE",
      "CENTRAL AFRICAN REPUBLIC",
      "CHAD",
      "CHILE",
      "CHINA",
      "COLOMBIA",
      "COMOROS",
      "CONGO",
      "COSTA RICA",
      "CROATIA",
      "CUBA",
      "CYPRUS",
      "CZECH REPUBLIC",
      "DENMARK",
      "DJIBOUTI",
      "DOMINICA",
      "DOMINICAN REPUBLIC",
      "ECUADOR",
      "EGYPT",
      "EL SALVADOR",
      "ERITREA",
      "ESTONIA",
      "ESWATINI",
      "ETHIOPIA",
      "FIJI",
      "FINLAND",
      "FRANCE",
      "GABON",
      "GAMBIA",
      "GEORGIA",
      "GERMANY",
      "GHANA",
      "GREECE",
      "GRENADA",
      "GUATEMALA",
      "GUINEA",
      "GUINEA-BISSAU",
      "GUYANA",
      "HAITI",
      "HONDURAS",
      "HONG KONG",
      "HUNGARY",
      "ICELAND",
      "INDIA",
      "INDONESIA",
      "IRAN",
      "IRAQ",
      "IRELAND",
      "ISRAEL",
      "ITALY",
      "JAMAICA",
      "JAPAN",
      "JORDAN",
      "KAZAKHSTAN",
      "KENYA",
      "KUWAIT",
      "KYRGYZSTAN",
      "LAOS",
      "LATVIA",
      "LEBANON",
      "LESOTHO",
      "LIBERIA",
      "LIBYA",
      "LIECHTENSTEIN",
      "LITHUANIA",
      "LUXEMBOURG",
      "MADAGASCAR",
      "MALAWI",
      "MALAYSIA",
      "MALDIVES",
      "MALI",
      "MALTA",
      "MAURITIUS",
      "MEXICO",
      "MOLDOVA",
      "MONACO",
      "MONGOLIA",
      "MONTENEGRO",
      "MOROCCO",
      "MOZAMBIQUE",
      "MYANMAR",
      "NAMIBIA",
      "NEPAL",
      "NETHERLANDS",
      "NEW ZEALAND",
      "NICARAGUA",
      "NIGER",
      "NIGERIA",
      "NORTH KOREA",
      "NORWAY",
      "OMAN",
      "PAKISTAN",
      "PALAU",
      "PANAMA",
      "PAPUA NEW GUINEA",
      "PARAGUAY",
      "PERU",
      "PHILIPPINES",
      "POLAND",
      "PORTUGAL",
      "QATAR",
      "ROMANIA",
      "RUSSIA",
      "RWANDA",
      "SAUDI ARABIA",
      "SENEGAL",
      "SERBIA",
      "SEYCHELLES",
      "SIERRA LEONE",
      "SINGAPORE",
      "SLOVAKIA",
      "SLOVENIA",
      "SOMALIA",
      "SOUTH AFRICA",
      "SOUTH KOREA",
      "SPAIN",
      "SRI LANKA",
      "SUDAN",
      "SURINAME",
      "SWEDEN",
      "SWITZERLAND",
      "SYRIA",
      "TAIWAN",
      "TAJIKISTAN",
      "TANZANIA",
      "THAILAND",
      "TOGO",
      "TRINIDAD AND TOBAGO",
      "TUNISIA",
      "TURKEY",
      "UGANDA",
      "UKRAINE",
      "UNITED ARAB EMIRATES",
      "UNITED KINGDOM",
      "UNITED STATES",
      "URUGUAY",
      "UZBEKISTAN",
      "VATICAN CITY",
      "VENEZUELA",
      "VIETNAM",
      "YEMEN",
      "ZAMBIA",
      "ZIMBABWE",
    ];

    const allowedCurrencies = [
      "AED",
      "AFN",
      "ALL",
      "AMD",
      "AOA",
      "ARS",
      "AUD",
      "AZN",
      "BAM",
      "BBD",
      "BDT",
      "BHD",
      "BIF",
      "BMD",
      "BND",
      "BOB",
      "BRL",
      "BSD",
      "BTN",
      "BWP",
      "BYN",
      "CAD",
      "CDF",
      "CHF",
      "CLP",
      "CNY",
      "COP",
      "CRC",
      "CUP",
      "CVE",
      "CZK",
      "DJF",
      "DKK",
      "DOP",
      "DZD",
      "EGP",
      "ERN",
      "ETB",
      "EUR",
      "FJD",
      "GBP",
      "GEL",
      "GHS",
      "GMD",
      "GNF",
      "GTQ",
      "GYD",
      "HKD",
      "HNL",
      "HTG",
      "HUF",
      "IDR",
      "ILS",
      "INR",
      "IQD",
      "IRR",
      "ISK",
      "JMD",
      "JOD",
      "JPY",
      "KES",
      "KGS",
      "KHR",
      "KMF",
      "KPW",
      "KRW",
      "KWD",
      "KZT",
      "LAK",
      "LBP",
      "LKR",
      "LRD",
      "LSL",
      "LYD",
      "MAD",
      "MDL",
      "MGA",
      "MMK",
      "MNT",
      "MOP",
      "MRU",
      "MUR",
      "MVR",
      "MWK",
      "MXN",
      "MYR",
      "MZN",
      "NAD",
      "NGN",
      "NIO",
      "NOK",
      "NPR",
      "NZD",
      "OMR",
      "PAB",
      "PEN",
      "PGK",
      "PHP",
      "PKR",
      "PLN",
      "PYG",
      "QAR",
      "RON",
      "RSD",
      "RUB",
      "RWF",
      "SAR",
      "SCR",
      "SDG",
      "SEK",
      "SGD",
      "SLL",
      "SOS",
      "SRD",
      "SSP",
      "STN",
      "SYP",
      "SZL",
      "THB",
      "TJS",
      "TMT",
      "TND",
      "TOP",
      "TRY",
      "TTD",
      "TWD",
      "TZS",
      "UAH",
      "UGX",
      "USD",
      "UYU",
      "UZS",
      "VES",
      "VND",
      "VUV",
      "WST",
      "XAF",
      "XCD",
      "XOF",
      "XPF",
      "YER",
      "ZAR",
      "ZMW",
      "ZWL",
    ];

    if (country && !allowedCountries.includes(country)) {
      return res.status(400).json({
        success: false,
        message: `Invalid country. Allowed values: ${allowedCountries.join(", ")}`,
      });
    }

    if (currency && !allowedCurrencies.includes(currency)) {
      return res.status(400).json({
        success: false,
        message: `Invalid currency. Allowed values: ${allowedCurrencies.join(", ")}`,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const newVendor = await tx.vendor.create({
        data: {
          name: upperCaseName,
          email: lowerCaseEmail || null,
          gstNumber: upperCaseGST || null,
          address: upperCaseAddress,
          city,
          state,
          pincode: pincode ? pincode.trim() : null,
          zipCode: zipCode ? zipCode.trim() : null,
          country: country || "INDIA",
          currency: currency || "INR",
          exchangeRate: exchangeRate || null,
          contactPerson,
          contactNumber,
          alternateNumber: null,
          createdBy: performedBy,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "Vendor",
          entityId: newVendor.id,
          action: "Created",
          performedBy,
          oldValue: null,
          newValue: newVendor,
        },
      });

      return newVendor;
    });

    return res.status(201).json({
      success: true,
      message: "Vendor created successfully.",
      data: result,
    });
  } catch (error) {
    console.error("❌ Error in createVendor:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const {
      name,
      companyCode,
      gstNumber,
      address,
      city,
      state,
      pincode,
      contactNumber,
      alternateNumber,
      email,
      country,
      currency,
    } = req.body;

    const existingCompany = await prisma.company.findUnique({ where: { id } });
    if (!existingCompany) {
      return res.status(404).json({ message: "Company not found" });
    }

    const updateData = {
      ...(name && { name }),
      ...(companyCode && { companyCode }),
      ...(gstNumber && { gstNumber }),
      ...(address && { address }),
      ...(city && { city }),
      ...(state && { state }),
      ...(pincode && { pincode }),
      ...(contactNumber && { contactNumber }),
      ...(alternateNumber && { alternateNumber }),
      ...(email && { email }),
      ...(country && { country }),
      ...(currency && { currency }),
    };

    const changedOldValues = {};
    const changedNewValues = {};
    for (const key in updateData) {
      if (existingCompany[key] !== updateData[key]) {
        changedOldValues[key] = existingCompany[key];
        changedNewValues[key] = updateData[key];
      }
    }

    if (Object.keys(changedNewValues).length === 0) {
      return res.status(400).json({ message: "No fields were changed." });
    }

    const [updatedCompany, auditLog] = await prisma.$transaction([
      prisma.company.update({
        where: { id },
        data: updateData,
      }),
      prisma.auditLog.create({
        data: {
          entityType: "Company",
          entityId: id,
          action: "Updated",
          performedBy: userId || null,
          oldValue: changedOldValues,
          newValue: changedNewValues,
        },
      }),
    ]);

    res.status(200).json({
      message: "Company data updated successfully",
      company: updatedCompany,
      auditLog,
    });
  } catch (error) {
    console.error("Error updating company:", error);
    res.status(500).json({
      message: error.message || "Internal Server Error",
      // error: error.message,
    });
  }
};

const updateVendor2 = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const {
      name,
      email,
      gstNumber,
      address,
      city,
      state,
      pincode,
      country,
      currency,
      exchangeRate,
      contactPerson,
      contactNumber,
      alternateNumber,
    } = req.body;

    const existingVendor = await prisma.vendor.findUnique({ where: { id } });
    if (!existingVendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const updateData = {
      ...(name && { name }),
      ...(email && { email }),
      ...(gstNumber && { gstNumber }),
      ...(address && { address }),
      ...(city && { city }),
      ...(state && { state }),
      ...(pincode && { pincode }),
      ...(country && { country }),
      ...(currency && { currency }),
      ...(exchangeRate && { exchangeRate }),
      ...(contactPerson && { contactPerson }),
      ...(contactNumber && { contactNumber }),
      ...(alternateNumber && { alternateNumber }),
    };

    const changedOldValues = {};
    const changedNewValues = {};

    for (const key in updateData) {
      if (existingVendor[key] !== updateData[key]) {
        changedOldValues[key] = existingVendor[key];
        changedNewValues[key] = updateData[key];
      }
    }

    if (Object.keys(changedNewValues).length === 0) {
      return res.status(400).json({ message: "No fields were changed." });
    }

    const [updatedVendor, auditLog] = await prisma.$transaction([
      prisma.vendor.update({
        where: { id },
        data: updateData,
      }),
      prisma.auditLog.create({
        data: {
          entityType: "Vendor",
          entityId: id,
          action: "Updated",
          performedBy: userId || null,
          oldValue: changedOldValues,
          newValue: changedNewValues,
        },
      }),
    ]);

    res.status(200).json({
      message: "Vendor updated successfully",
      vendor: updatedVendor,
      auditLog,
    });
  } catch (error) {
    console.error("Error updating vendor:", error);
    res.status(500).json({
      message: error.message || "Internal Server Error",
      // error: error.message,
    });
  }
};

//for dropdown
const getCompaniesList = async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        state: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const formattedCompanies = companies.map((company) => ({
      id: company.id,
      companyName: `${company.name}${company.state ? `, ${company.state}` : ""}`,
    }));

    return res.status(200).json({
      success: true,
      message: "Companies fetched successfully.",
      data: formattedCompanies || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getCompaniesData = async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      select: {
        id: true,
        name: true,
        gstNumber: true,
        state: true,
        address: true,
        country: true,
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Companies fetched successfully.",
      data: companies || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const id = req.params.id || req.query?.id;

    if (!id) {
      return res.status(400).json({ message: "Company ID is required" });
    }

    const company = await prisma.company.findUnique({
      where: { id: id },
      select: {
        id: true,
        name: true,
        companyCode: true,
        gstNumber: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        contactNumber: true,
        alternateNumber: true,
        email: true,
        country: true,
        currency: true,
        isActive: true,
      },
    });

    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }

    res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    console.error("Error fetching company by ID:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getVendorsList = async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        country: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    const formattedVendors = vendors.map((vendor) => ({
      id: vendor.id,
      displayName: `${vendor.name}${vendor.country ? `, ${vendor.country}` : ""}`,
    }));

    return res.status(200).json({
      success: true,
      message: "Vendors fetched successfully.",
      data: formattedVendors || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getVendorsData = async (req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({
      select: {
        id: true,
        name: true,
        gstNumber: true,
        state: true,
        address: true,
        country: true,
        isActive: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Vendors fetched successfully.",
      data: vendors || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getVendorById2 = async (req, res) => {
  try {
    const id = req.params.id || req.query?.id;

    if (!id) {
      return res.status(400).json({ message: "Vendor ID is required" });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        gstNumber: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        country: true,
        currency: true,
        exchangeRate: true,
        contactPerson: true,
        contactNumber: true,
        alternateNumber: true,
        isActive: true,
      },
    });

    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    res.status(200).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    console.error("Error fetching vendor by ID:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getItemsList = async (req, res) => {
  try {
    const mysqlItems = await prisma.rawMaterial.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    const formattedMySQL = mysqlItems.map((item) => ({
      id: item.id,
      name: item.name,
      source: "mysql",
    }));

    const mongoItems = await SystemItem.find({}, { itemName: 1 }).lean();

    const formattedMongo = mongoItems.map((item) => ({
      id: item._id.toString(),
      name: item.itemName,
      source: "mongo",
    }));

    // 🔁 MERGE
    const allItems = [...formattedMySQL, ...formattedMongo];

    // 🔤 SORT BY NAME (CASE-INSENSITIVE)
    allItems.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
      }),
    );

    return res.status(200).json({
      success: true,
      count: allItems.length,
      items: allItems,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch items",
    });
  }
};

const getItemDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const mysqlItem = await prisma.rawMaterial.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        unit: true,
        hsnCode: true,
        description: true,
      },
    });

    if (mysqlItem) {
      return res.status(200).json({
        success: true,
        source: "mysql",
        item: mysqlItem,
      });
    }

    const mongoItem = await SystemItem.findById(id, {
      itemName: 1,
      unit: 1,
      hsnCode: 1,
      description: 1,
    }).lean();

    if (mongoItem) {
      return res.status(200).json({
        success: true,
        source: "mongo",
        item: {
          id: mongoItem._id.toString(),
          name: mongoItem.itemName,
          unit: mongoItem.unit || "",
          hsnCode: mongoItem.hsnCode || "",
          description: mongoItem.description || "",
        },
      });
    }

    return res.status(404).json({
      success: false,
      message: "Item data not found",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch item details",
    });
  }
};

const getGSTPercent = (type) => {
  if (!type) return new Decimal(0);
  if (type.includes("EXEMPTED")) return new Decimal(0);

  const match = type.match(/_(\d+(\.\d+)?)/);
  return match ? new Decimal(match[1]) : new Decimal(0);
};

function roundGrandTotal(value) {
  const amount = new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const integerPart = amount.floor();
  const decimalPart = amount.minus(integerPart);

  if (decimalPart.greaterThanOrEqualTo(new Decimal(0.5))) {
    return integerPart.plus(1).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  }

  return integerPart.toDecimalPlaces(4, Decimal.ROUND_DOWN);
}

const createPurchaseOrder = async (req, res) => {
  try {
    const {
      warehouseId,
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      expectedDeliveryDate,
      otherCharges = [],
      prePoId = null
    } = req.body;

    logger.error({
      message: "Incoming PO Request",
      data: req.body
    });

    if (prePoId) {

      let prePo = await prisma.prePo.findFirst({
        where: {
          id: prePoId
        }
      })

      if (!prePo) return res.status(404).json({ success: false, message: "PrePo Not found" });

    }

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can create PO",
      });
    }

    if (!warehouseId || !companyId || !vendorId || !gstType || !items?.length) {
      return res.status(400).json({
        success: false,
        message:
          "Receiving Warheouse, Company, Vendor, GST Type & Items are required",
      });
    }

    if (expectedDeliveryDate) {
      const poDateOnly = new Date();
      poDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      // if (poDateOnly.getTime() === expectedDateOnly.getTime()) {
      //   return res.status(400).json({
      //     success: false,
      //     message: "Expected Delivery Date cannot be same as PO Date",
      //   });
      // }

      if (expectedDateOnly < poDateOnly) {
        return res.status(400).json({
          success: false,
          message: "Expected Delivery Date cannot be before PO Date",
        });
      }
    }

    let normalizedOtherCharges = [];

    // Case 1: Frontend sends single empty object → treat as empty
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const isItemWise = gstType.includes("ITEMWISE");

    for (const item of items) {
      if (!item.id || !item.name || !item.unit) {
        return res.status(400).json({
          success: false,
          message: "Items must include id, name, unit",
        });
      }
      if (!item.rate || !item.quantity || Number(item.quantity) < 0) {
        return res.status(400).json({
          success: false,
          message: "Each item must have valid quantity & rate",
        });
      }
      if (isItemWise && (item.gstRate == null || item.gstRate === "")) {
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });
      }
      if (!isItemWise && item.gstRate) {
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
      }
    }

    // ✅ Collect all IDs
    const allIds = items.map((i) => String(i.id));

    // ✅ Only valid Mongo ObjectIds
    const mongoIds = allIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    // ✅ Remaining are MySQL UUIDs
    const mysqlIds = allIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );

    // ✅ Fetch from Mongo
    const mongoItems = await SystemItem.find({
      _id: { $in: mongoIds },
    })
      .select("_id itemName")
      .lean();

    // ✅ Fetch from MySQL
    const mysqlItems = await prisma.rawMaterial.findMany({
      where: { id: { in: mysqlIds } },
      select: { id: true, name: true },
    });

    // ✅ Create lookup maps
    const mongoMap = new Map(
      mongoItems.map((i) => [String(i._id), i.itemName?.trim()]),
    );

    const mysqlMap = new Map(mysqlItems.map((i) => [i.id, i.name?.trim()]));

    for (const item of items) {
      const id = String(item.id);
      const name = item.name;

      if (!mongoMap.has(id) && !mysqlMap.has(id)) {
        throw new Error(`Item not found in any DB: ${name}`);
      }
    }

    // ✅ Validate + detect source
    const validatedItems = items.map((item) => {
      const id = String(item.id);
      const name = item.name?.trim();

      let detectedSource = null;

      if (mongoMap.has(id)) {
        const dbName = mongoMap.get(id);

        if (dbName !== name) {
          throw new Error(`Item name mismatch for Mongo ID ${id}`);
        }

        detectedSource = "mongo";
      } else if (mysqlMap.has(id)) {
        const dbName = mysqlMap.get(id);

        if (dbName !== name) {
          throw new Error(`Item name mismatch for MySQL ID ${id}`);
        }

        detectedSource = "mysql";
      } else {
        throw new Error(`Item not found in any DB: ${id}`);
      }

      return {
        ...item,
        source: detectedSource,
      };
    });

    console.table(
      validatedItems.map((i) => ({
        id: i.id,
        source: i.source,
        name: i.name,
      })),
    );

    // Fetch company & vendor
    const [company, vendor] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);

    if (!company || !vendor) {
      return res.status(404).json({
        success: false,
        message: "Company/Vendor not found",
      });
    }

    // PO currency and exchange rate
    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      exchangeRate && Number(exchangeRate) > 0
        ? new Decimal(exchangeRate).toDecimalPlaces(4, Decimal.ROUND_DOWN)
        : new Decimal(1);

    const poNumber = await generatePONumber(company);
    if (await prisma.purchaseOrder.findUnique({ where: { poNumber } })) {
      return res.status(400).json({
        success: false,
        message: `PO ${poNumber} already exists`,
      });
    }

    // ------------------------------------
    // 🧮 Subtotal & GST Calculations
    // ------------------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // Process items for DB
    const processedItems = items.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,
        rateInForeign: currency !== "INR" ? rateForeign : null,
        amountInForeign: currency !== "INR" ? amountForeign : null,
        rate: new Decimal(item.rate),
        gstRate: isItemWise ? new Decimal(item.gstRate) : null,
        quantity: qty,
        total: amountINR,
        itemGSTType: isItemWise ? gstType : null,
      };
    });

    // Add otherCharges to subtotal
    let otherChargesTotal = new Decimal(0);
    if (
      Array.isArray(normalizedOtherCharges) &&
      normalizedOtherCharges.length > 0
    ) {
      for (const ch of normalizedOtherCharges) {
        if (!ch.amount || isNaN(ch.amount)) continue;
        otherChargesTotal = otherChargesTotal.plus(new Decimal(ch.amount));
      }
    }
    let inrOtherChargesTotal = 0;
    if (finalCurrency !== "INR") {
      inrOtherChargesTotal = otherChargesTotal
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    }
    subTotalINR =
      finalCurrency === "INR"
        ? subTotalINR.plus(otherChargesTotal)
        : subTotalINR.plus(inrOtherChargesTotal);

    // GST for normal items
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(poGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(poGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(poGSTPercent.div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // Item-wise GST
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotal = subTotalINR.plus(totalGST);
    const grandTotalINR = roundGrandTotal(rawGrandTotal);
    foreignSubTotal = foreignSubTotal.plus(otherChargesTotal);
    const foreignGrandTotal = roundGrandTotal(foreignSubTotal);

    let warehouseName = null;
    const warehouseData = await Warehouse.findById(warehouseId);
    
    if (warehouseData) {
      warehouseName = warehouseData?.warehouseName;
    }

    // ------------------------------------
    // 💾 Save Purchase Order
    // ------------------------------------

    const newPO = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          financialYear: getFinancialYear(),
          companyId,
          companyName: company.name,
          vendorId,
          vendorName: vendor.name,
          warehouseId,
          warehouseName,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate,
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          fixedGrandTotal: rawGrandTotal,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          createdBy: userId,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : null,
          otherCharges: normalizedOtherCharges,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "CREATED",
          performedBy: userId,
          newValue: po,
        },
      });

      return po;
    });


    if (prePoId) {

      await prisma.prePo.update({
        where: {
          id: prePoId
        },
        data: {
          poId: newPO.id,
          poNumber: newPO.poNumber,
          status: 'PO_GENERATED',
          updatedBy: req.user.id
        }
      });
    }


    logger.error({
      message: "Outgoing PO Response",
      data: newPO
    });
    return res.status(201).json({
      success: true,
      message: "✅ Purchase Order created successfully",
      data: newPO,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error while creating PO",
    });
  }
};

const splitInclusiveGST = (rate, qty, gstRate) => {
  const gstMultiplier = new Decimal(1).plus(gstRate.div(100));

  const baseRate = rate.div(gstMultiplier);
  const gstPerUnit = rate.minus(baseRate);

  const baseTotal = baseRate.mul(qty);
  const gstTotal = gstPerUnit.mul(qty);

  return {
    baseRate,
    gstPerUnit,
    baseTotal,
    gstTotal,
  };
};

const createPurchaseOrder2 = async (req, res) => {
  try {
    const {
      warehouseId,
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      expectedDeliveryDate,
      otherCharges = [],
    } = req.body;

    console.log("Req Body: ", req.body);

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can create PO",
      });
    }

    if (!warehouseId || !companyId || !vendorId || !gstType || !items?.length) {
      return res.status(400).json({
        success: false,
        message:
          "Receiving Warheouse, Company, Vendor, GST Type & Items are required",
      });
    }

    if (expectedDeliveryDate) {
      const poDateOnly = new Date();
      poDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      // if (poDateOnly.getTime() === expectedDateOnly.getTime()) {
      //   return res.status(400).json({
      //     success: false,
      //     message: "Expected Delivery Date cannot be same as PO Date",
      //   });
      // }

      if (expectedDateOnly < poDateOnly) {
        return res.status(400).json({
          success: false,
          message: "Expected Delivery Date cannot be before PO Date",
        });
      }
    }

    let normalizedOtherCharges = [];

    // Case 1: Frontend sends single empty object → treat as empty
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const isItemWise = gstType.includes("ITEMWISE");
    const isInclusive = gstType.includes("INCLUSIVE");
    console.log("Items List: ", items);
    // Validate items
    for (const item of items) {
      console.log("Item: ", item);
      if (!item.id || !item.name || !item.unit) {
        return res.status(400).json({
          success: false,
          message: "Items must include id, name, unit",
        });
      }

      if (!item.rate || !item.quantity || Number(item.quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Each item must have valid quantity & rate",
        });
      }

      if (isItemWise && (item.gstRate == null || item.gstRate === "")) {
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });
      }

      if (isInclusive && (item.gstRate == null || item.gstRate === "")) {
        return res.status(400).json({
          success: false,
          message: "gstRate is required for INCLUSIVE GST type",
        });
      }

      if (!isItemWise && !isInclusive && item.gstRate) {
        return res.status(400).json({
          success: false,
          message:
            "gstRate is only allowed when PO GST type is ITEMWISE or INCLUSIVE",
        });
      }
    }

    // ✅ Collect all IDs
    const allIds = items.map((i) => String(i.id));

    // ✅ Only valid Mongo ObjectIds
    const mongoIds = allIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    // ✅ Remaining are MySQL UUIDs
    const mysqlIds = allIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );

    // ✅ Fetch from Mongo
    const mongoItems = await SystemItem.find({
      _id: { $in: mongoIds },
    })
      .select("_id itemName")
      .lean();

    // ✅ Fetch from MySQL
    const mysqlItems = await prisma.rawMaterial.findMany({
      where: { id: { in: mysqlIds } },
      select: { id: true, name: true },
    });

    // ✅ Create lookup maps
    const mongoMap = new Map(
      mongoItems.map((i) => [String(i._id), i.itemName?.trim()]),
    );

    const mysqlMap = new Map(mysqlItems.map((i) => [i.id, i.name?.trim()]));

    for (const item of items) {
      const id = String(item.id);
      const name = item.name;

      if (!mongoMap.has(id) && !mysqlMap.has(id)) {
        throw new Error(`Item not found in any DB: ${name}`);
      }
    }

    // ✅ Validate + detect source
    const validatedItems = items.map((item) => {
      const id = String(item.id);
      const name = item.name?.trim();

      let detectedSource = null;

      if (mongoMap.has(id)) {
        const dbName = mongoMap.get(id);

        if (dbName !== name) {
          throw new Error(`Item name mismatch for Mongo ID ${id}`);
        }

        detectedSource = "mongo";
      } else if (mysqlMap.has(id)) {
        const dbName = mysqlMap.get(id);

        if (dbName !== name) {
          throw new Error(`Item name mismatch for MySQL ID ${id}`);
        }

        detectedSource = "mysql";
      } else {
        throw new Error(`Item not found in any DB: ${id}`);
      }

      return {
        ...item,
        source: detectedSource,
      };
    });

    console.table(
      validatedItems.map((i) => ({
        id: i.id,
        source: i.source,
        name: i.name,
      })),
    );

    // Fetch company & vendor
    const [company, vendor] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);

    if (!company || !vendor) {
      return res.status(404).json({
        success: false,
        message: "Company/Vendor not found",
      });
    }

    // PO currency and exchange rate
    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      exchangeRate && Number(exchangeRate) > 0
        ? new Decimal(exchangeRate).toDecimalPlaces(4, Decimal.ROUND_DOWN)
        : new Decimal(1);

    const poNumber = await generatePONumber(company);
    if (await prisma.purchaseOrder.findUnique({ where: { poNumber } })) {
      return res.status(400).json({
        success: false,
        message: `PO ${poNumber} already exists`,
      });
    }

    // ------------------------------------
    // 🧮 Subtotal & GST Calculations
    // ------------------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // Process items for DB
    const processedItems = validatedItems.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      // const amountForeign = rateForeign
      //   .mul(qty)
      //   .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      // const amountINR = amountForeign
      //   .mul(finalExchangeRate)
      //   .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      // foreignSubTotal = foreignSubTotal.plus(amountForeign);
      // subTotalINR = subTotalINR.plus(amountINR);

      let baseAmountForeign = rateForeign.mul(qty);
      let gstAmountForeign = new Decimal(0);

      if (isInclusive) {
        if (!item.gstRate) {
          throw new Error("gstRate required for INCLUSIVE GST type");
        }

        const gstRate = new Decimal(item.gstRate);
        const split = splitInclusiveGST(rateForeign, qty, gstRate);

        baseAmountForeign = split.baseTotal;
        gstAmountForeign = split.gstTotal;
      }

      const baseAmountINR = baseAmountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      const gstAmountINR = gstAmountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      // ✅ Update totals
      foreignSubTotal = foreignSubTotal.plus(baseAmountForeign);
      subTotalINR = subTotalINR.plus(baseAmountINR);

      // ✅ Add GST separately (ONLY for inclusive)
      if (isInclusive) {
        if (gstType.startsWith("LGST")) {
          totalCGST = totalCGST.plus(gstAmountINR.div(2));
          totalSGST = totalSGST.plus(gstAmountINR.div(2));
        } else {
          totalIGST = totalIGST.plus(gstAmountINR);
        }
      }

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,
        rateInForeign: currency !== "INR" ? rateForeign : null,
        amountInForeign: currency !== "INR" ? baseAmountForeign : null,
        rate: new Decimal(item.rate),
        gstRate: isItemWise || isInclusive ? new Decimal(item.gstRate) : null,
        quantity: qty,
        total: baseAmountINR,
        itemGSTType: isItemWise ? gstType : null,
      };
    });

    // Add otherCharges to subtotal
    let otherChargesTotal = new Decimal(0);
    if (
      Array.isArray(normalizedOtherCharges) &&
      normalizedOtherCharges.length > 0
    ) {
      for (const ch of normalizedOtherCharges) {
        if (!ch.amount || isNaN(ch.amount)) continue;
        otherChargesTotal = otherChargesTotal.plus(new Decimal(ch.amount));
      }
    }
    let inrOtherChargesTotal = 0;
    if (finalCurrency !== "INR") {
      inrOtherChargesTotal = otherChargesTotal
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    }
    subTotalINR =
      finalCurrency === "INR"
        ? subTotalINR.plus(otherChargesTotal)
        : subTotalINR.plus(inrOtherChargesTotal);

    // GST for normal items
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (!isInclusive && normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(poGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(poGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(poGSTPercent.div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // Item-wise GST
    if (!isInclusive && isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotal = subTotalINR.plus(totalGST);
    const grandTotalINR = roundGrandTotal(rawGrandTotal);
    foreignSubTotal = foreignSubTotal.plus(otherChargesTotal);
    const foreignGrandTotal = roundGrandTotal(foreignSubTotal);

    let warehouseName = null;
    const warehouseData = await Warehouse.findById(warehouseId);
    if (warehouseData) {
      warehouseName = warehouseData?.warehouseName;
    }
    console.log(warehouseName);
    // ------------------------------------
    // 💾 Save Purchase Order
    // ------------------------------------
    const newPO = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          financialYear: getFinancialYear(),
          companyId,
          companyName: company.name,
          vendorId,
          vendorName: vendor.name,
          warehouseId,
          warehouseName,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate,
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          fixedGrandTotal: rawGrandTotal,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          createdBy: userId,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : null,
          otherCharges: normalizedOtherCharges,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "CREATED",
          performedBy: userId,
          newValue: po,
        },
      });

      return po;
    });
    console.log("Saved PO: ", newPO);
    return res.status(201).json({
      success: true,
      message: "✅ Purchase Order created successfully",
      data: newPO,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error while creating PO",
    });
  }
};

const updatePurchaseOrder = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      warehouseId,
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      expectedDeliveryDate,
      otherCharges = [],
    } = req.body;

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can update PO",
      });
    }

    let normalizedOtherCharges = [];
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const existingPO = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });

    if (!existingPO)
      return res.status(404).json({ success: false, message: "PO not found" });

    // if (existingPO.status !== "Draft") {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Only Draft PO can be updated",
    //   });
    // }

    if (expectedDeliveryDate) {
      const poDateOnly = new Date(existingPO.poDate);
      poDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      // if (poDateOnly.getTime() === expectedDateOnly.getTime()) {
      //   return res.status(400).json({
      //     success: false,
      //     message:
      //       "Expected Delivery Date cannot be the same as Purchase Order Date",
      //   });
      // }

      if (expectedDateOnly < poDateOnly) {
        return res.status(400).json({
          success: false,
          message:
            "Expected Delivery Date cannot be earlier than Purchase Order Date",
        });
      }
    }

    if (!items?.length)
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });

    const isItemWise = gstType.includes("ITEMWISE");

    // Validate items
    for (const item of items) {
      if (!item.id || !item.name || !item.unit)
        return res.status(400).json({
          success: false,
          message: "Each item must include id, name, and unit",
        });

      if (!item.rate || !item.quantity || Number(item.quantity) <= 0)
        return res.status(400).json({
          success: false,
          message: "Each item must have valid rate and quantity",
        });

      if (isItemWise && (item.gstRate == null || item.gstRate === ""))
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });

      if (!isItemWise && item.gstRate)
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
    }

    const oldValue = JSON.parse(JSON.stringify(existingPO));

    // Fetch vendor
    const vendorToUseId = vendorId || existingPO.vendorId;
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorToUseId },
    });

    if (!vendor)
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });

    const companyToUseId = companyId || existingPO.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyToUseId },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      finalCurrency === "INR"
        ? new Decimal(1)
        : new Decimal(exchangeRate || 1).toDecimalPlaces(4, Decimal.ROUND_DOWN);

    // -------------------------
    // Totals
    // -------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // -------------------------
    // ⭐ UNIVERSAL GST LOGIC FOR EACH ITEM ⭐
    // -------------------------
    const processedItems = items.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      let itemGSTType = null;
      let itemGSTRate = null;

      const isExempted = gstType.includes("EXEMPTED");
      const isItemWiseGST = gstType.includes("ITEMWISE");

      if (isExempted) {
        // CASE 1 — EXEMPTED
        itemGSTType = null;
        itemGSTRate = null;
      } else if (isItemWiseGST) {
        // CASE 2 — ITEMWISE
        itemGSTType = gstType;
        itemGSTRate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );
      } else {
        // CASE 3 — Normal IGST/LGST 5/12/18/28
        itemGSTRate = null;
        itemGSTType = null;
      }

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,

        rateInForeign: finalCurrency !== "INR" ? rateForeign : null,
        amountInForeign: finalCurrency !== "INR" ? amountForeign : null,

        rate: new Decimal(item.rate),
        quantity: qty,

        gstRate: itemGSTRate,
        itemGSTType: itemGSTType,

        total: amountINR,
      };
    });

    // OTHER CHARGES
    let otherChargesTotal = new Decimal(0);
    if (Array.isArray(otherCharges)) {
      for (const ch of otherCharges) {
        if (ch == null) continue;
        const amt = ch.amount ?? ch.value ?? null;
        if (amt == null || isNaN(amt)) continue;
        otherChargesTotal = otherChargesTotal
          .plus(new Decimal(amt))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }
    subTotalINR = subTotalINR.plus(otherChargesTotal);

    // GST FOR NORMAL ITEMS
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // GST FOR ITEMWISE
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotalINR = subTotalINR
      .plus(totalGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const grandTotalINR = roundGrandTotal(rawGrandTotalINR);
    const foreignGrandTotal = foreignSubTotal.toDecimalPlaces(
      4,
      Decimal.ROUND_DOWN,
    );

    const updatedPO = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: poId },
      });

      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          companyId: companyId || existingPO.companyId,
          companyName: company.name || existingPO.companyName,
          vendorId: vendorId || existingPO.vendorId,
          vendorName: vendor.name || existingPO.vendorName,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate.toString(),
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : existingPO.expectedDeliveryDate,
          otherCharges: normalizedOtherCharges,
          warehouseId: warehouseId || existingPO.warehouseId,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "UPDATED",
          performedBy: userId,
          oldValue,
          newValue: po,
        },
      });

      return po;
    });

    res.json({
      success: true,
      message: "✅ Purchase Order updated successfully",
      data: updatedPO,
    });
  } catch (err) {
    console.error("PO Update Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error while updating PO",
    });
  }
};

const updatePurchaseOrder2 = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      otherCharges = [],
    } = req.body;

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can update PO",
      });
    }
    let normalizedOtherCharges = [];
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const existingPO = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });

    if (!existingPO)
      return res.status(404).json({ success: false, message: "PO not found" });

    // if (existingPO.status !== "Draft") {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Only Draft PO can be updated",
    //   });
    // }

    if (!items?.length)
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });

    const isItemWise = gstType.includes("ITEMWISE");

    // Validate items
    for (const item of items) {
      if (!item.id || !item.name || !item.unit)
        return res.status(400).json({
          success: false,
          message: "Each item must include id, name, and unit",
        });

      if (!item.rate || !item.quantity || Number(item.quantity) <= 0)
        return res.status(400).json({
          success: false,
          message: "Each item must have valid rate and quantity",
        });

      if (isItemWise && (item.gstRate == null || item.gstRate === ""))
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });

      if (!isItemWise && item.gstRate)
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
    }

    const oldValue = JSON.parse(JSON.stringify(existingPO));

    // Fetch vendor
    const vendorToUseId = vendorId || existingPO.vendorId;
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorToUseId },
    });

    if (!vendor)
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });

    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      finalCurrency === "INR"
        ? new Decimal(1)
        : new Decimal(exchangeRate || 1).toDecimalPlaces(4, Decimal.ROUND_DOWN);

    // -------------------------
    // Totals
    // -------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // -------------------------
    // ⭐ UNIVERSAL GST LOGIC FOR EACH ITEM ⭐
    // -------------------------
    const processedItems = items.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      let itemGSTType = null;
      let itemGSTRate = null;

      const isExempted = gstType.includes("EXEMPTED");
      const isItemWiseGST = gstType.includes("ITEMWISE");

      if (isExempted) {
        // CASE 1 — EXEMPTED
        itemGSTType = null;
        itemGSTRate = null;
      } else if (isItemWiseGST) {
        // CASE 2 — ITEMWISE
        itemGSTType = gstType;
        itemGSTRate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );
      } else {
        // CASE 3 — Normal IGST/LGST 5/12/18/28
        itemGSTRate = null;
        itemGSTType = null;
      }

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,

        rateInForeign: finalCurrency !== "INR" ? rateForeign : null,
        amountInForeign: finalCurrency !== "INR" ? amountForeign : null,

        rate: new Decimal(item.rate),
        quantity: qty,

        gstRate: itemGSTRate,
        itemGSTType: itemGSTType,

        total: amountINR,
      };
    });

    // OTHER CHARGES
    let otherChargesTotal = new Decimal(0);
    if (Array.isArray(otherCharges)) {
      for (const ch of otherCharges) {
        if (ch == null) continue;
        const amt = ch.amount ?? ch.value ?? null;
        if (amt == null || isNaN(amt)) continue;
        otherChargesTotal = otherChargesTotal
          .plus(new Decimal(amt))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }
    subTotalINR = subTotalINR.plus(otherChargesTotal);

    // GST FOR NORMAL ITEMS
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // GST FOR ITEMWISE
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotalINR = subTotalINR
      .plus(totalGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const grandTotalINR = roundGrandTotal(rawGrandTotalINR);
    const foreignGrandTotal = foreignSubTotal.toDecimalPlaces(
      4,
      Decimal.ROUND_DOWN,
    );

    const updatedPO = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: poId },
      });

      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          companyId: companyId || existingPO.companyId,
          vendorId: vendorId || existingPO.vendorId,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate.toString(),
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          otherCharges: normalizedOtherCharges,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "UPDATED",
          performedBy: userId,
          oldValue,
          newValue: po,
        },
      });

      return po;
    });

    res.json({
      success: true,
      message: "✅ Purchase Order updated successfully",
      data: updatedPO,
    });
  } catch (err) {
    console.error("PO Update Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error while updating PO",
    });
  }
};

const getPOList = async (req, res) => {
  try {
    const {
      poNumber,
      company,
      vendor,
      itemName,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNumber = Math.max(parseInt(page), 1);
    const pageSize = Math.max(parseInt(limit), 1);
    const skip = (pageNumber - 1) * pageSize;

    const userId = req.user?.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || !["Purchase", "Admin"].includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // 🧠 Build dynamic AND filters
    const whereCondition = {
      AND: [
        poNumber && {
          poNumber: { contains: poNumber.trim() },
        },

        company && {
          companyName: { contains: company.trim() },
        },

        vendor && {
          vendorName: { contains: vendor.trim() },
        },

        itemName && {
          items: {
            some: {
              itemName: { contains: itemName.trim() },
            },
          },
        },
      ].filter(Boolean), // 🔑 remove undefined filters
    };

    const totalCount = await prisma.purchaseOrder.count({
      where: whereCondition,
    });

    const poList = await prisma.purchaseOrder.findMany({
      where: whereCondition,
      skip,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        poNumber: true,
        poDate: true,
        companyId: true,
        companyName: true,
        vendorId: true,
        vendorName: true,
        currency: true,
        foreignGrandTotal: true,
        grandTotal: true,
        status: true,
        expectedDeliveryDate: true,
        // ✅ Always return ALL items
        items: {
          select: {
            id: true,
            itemId: true,
            itemSource: true,
            itemName: true,
          },
        },
      },
    });

    const formattedPOList = poList.map((po) => ({
      ...po,
      displayGrandTotal:
        po.currency === "INR" ? po.grandTotal : po.foreignGrandTotal,
    }));

    return res.status(200).json({
      success: true,
      message: "PO list fetched successfully",
      data: formattedPOList,
      pagination: {
        total: totalCount,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching PO list:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getPOListByCompany2 = async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    const pageNumber = Math.max(parseInt(page), 1);
    const pageSize = Math.max(parseInt(limit), 1);
    const skip = (pageNumber - 1) * pageSize;

    const userId = req.user?.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || !["Purchase", "Admin"].includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // 🔍 Common search condition
    const whereCondition = {
      ...(q && {
        OR: [
          { poNumber: { contains: q } },
          { companyName: { contains: q } },
          { vendorName: { contains: q } },
          {
            items: {
              some: {
                itemName: { contains: q },
              },
            },
          },
        ],
      }),
    };

    // 🔢 total count (for pagination)
    const totalCount = await prisma.purchaseOrder.count({
      where: whereCondition,
    });

    // 📦 paginated data
    const poList = await prisma.purchaseOrder.findMany({
      where: whereCondition,
      skip,
      take: pageSize,
      select: {
        id: true,
        poNumber: true,
        companyId: true,
        companyName: true,
        vendorId: true,
        vendorName: true,
        items: {
          select: {
            id: true,
            itemId: true,
            itemSource: true,
            itemName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      success: true,
      message: "PO list fetched successfully",
      data: poList,
      pagination: {
        total: totalCount,
        page: pageNumber,
        limit: pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error) {
    console.error("Error fetching PO list:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getPurchaseOrderDetails = async (req, res) => {
  try {
    const { poId } = req.params;

    if (!poId) {
      return res.status(400).json({
        success: false,
        message: "Purchase Order ID is required",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        id: true,
        poNumber: true,
        companyId: true,
        companyName: true,
        vendorId: true,
        vendorName: true,
        warehouseId: true,
        poDate: true,
        expectedDeliveryDate: true,
        gstType: true,
        gstRate: true,
        currency: true,
        exchangeRate: true,
        foreignSubTotal: true,
        foreignGrandTotal: true,
        subTotal: true,
        grandTotal: true,
        status: true,
        remarks: true,
        paymentTerms: true,
        deliveryTerms: true,
        contactPerson: true,
        cellNo: true,
        warranty: true,
        createdAt: true,
        otherCharges: true,
        items: {
          select: {
            id: true,
            purchaseOrderId: true,
            itemId: true,
            itemSource: true,
            itemName: true,
            hsnCode: true,
            modelNumber: true,
            itemDetail: true,
            unit: true,
            rate: true,
            gstRate: true,
            quantity: true,
            amountInForeign: true,
            receivedQty: true,
            total: true,
          },
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    let warehouseName = null;
    if (po.warehouseId) {
      const warehouse = await Warehouse.findById(po.warehouseId).select(
        "warehouseName",
      );
      warehouseName = warehouse?.warehouseName || null;
    }

    return res.json({
      success: true,
      message: "PO details fetched successfully",
      data: {
        ...po,
        warehouseName,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching PO details:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

//------------ Download PO Pdf -------------------//

const downloadPOPDF = async (req, res) => {
  try {
    const { poId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not found.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const allowedRoles = ["Purchase", "Admin", "Production"];

    if (!user || !allowedRoles.includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message: `Access Denied: Only ${allowedRoles.join(" & ")} can generate PO.`,
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { company: true, vendor: true, items: true },
    });

    if (!po) {
      return res.status(404).json({ success: false, message: "PO not found." });
    }

    // Freeze item values exactly as stored
    const items = po.items.map((it) => ({
      itemName: it.itemName,
      hsnCode: it.hsnCode || "-",
      quantity: Number(it.quantity),
      modelNumber: it.modelNumber || null,
      itemDetail: it.itemDetail || null,
      unit: it.unit || "Nos",
      rate: Number(it.rate),
      total: Number(it.total),
      gstRate: it.gstRate ? Number(it.gstRate) : 0,
      rateInForeign: it.rateInForeign ? Number(it.rateInForeign) : null,
      amountInForeign: it.amountInForeign ? Number(it.amountInForeign) : null,
    }));

    const pdfBuffer = await generatePO(po, items);

    // sanitize vendor name
    const vendor = po.vendor.name.split(" ")[0];
    const fileName = `${vendor}-PO-${po.poNumber}.pdf`;

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const oldPdfData =
        po.pdfUrl || po.pdfName || po.pdfGeneratedAt
          ? {
            pdfName: po.pdfName,
            pdfUrl: po.pdfUrl,
            generatedAt: po.pdfGeneratedAt,
            generatedBy: po.pdfGeneratedBy,
          }
          : null;

      const newPdfData = {
        pdfName: fileName,
        pdfUrl: null,
        generatedAt: now,
        generatedBy: userId,
      };

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          //status: "Generated_Downloaded",
          pdfName: fileName,
          pdfGeneratedAt: now,
          pdfGeneratedBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: poId,
          action: "Generated PDF",
          performedBy: userId,
          oldValue: oldPdfData,
          newValue: newPdfData,
        },
      });
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": Buffer.byteLength(pdfBuffer),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });

    return res.end(pdfBuffer);
  } catch (err) {
    console.error("❌ Error generating PO PDF:", err.stack || err);
    return res.status(500).json({
      success: false,
      message: "Server Error while generating PO PDF",
      error: err.message,
    });
  }
};

const downloadPOPDF2 = async (req, res) => {
  try {
    const { poId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not found.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const allowedRoles = ["Purchase", "Admin"];

    if (!user || !allowedRoles.includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message: `Access Denied: Only ${allowedRoles.join(" & ")} can generate PO.`,
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        company: true,
        vendor: true,
        items: true,
        termsConditions: true,
      },
    });

    if (!po) {
      return res.status(404).json({ success: false, message: "PO not found." });
    }

    // Freeze item values exactly as stored
    const items = po.items.map((it) => ({
      itemName: it.itemName,
      hsnCode: it.hsnCode || "-",
      quantity: Number(it.quantity),
      modelNumber: it.modelNumber || null,
      itemDetail: it.itemDetail || null,
      unit: it.unit || "Nos",
      rate: Number(it.rate),
      total: Number(it.total),
      gstRate: it.gstRate ? Number(it.gstRate) : 0,
      rateInForeign: it.rateInForeign ? Number(it.rateInForeign) : null,
      amountInForeign: it.amountInForeign ? Number(it.amountInForeign) : null,
    }));

    const pdfBuffer = await poGenerate(po, items);

    // sanitize vendor name
    const vendor = po.vendor.name.split(" ")[0];
    const fileName = `${vendor}-PO-${po.poNumber}.pdf`;

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const oldPdfData =
        po.pdfUrl || po.pdfName || po.pdfGeneratedAt
          ? {
            pdfName: po.pdfName,
            pdfUrl: po.pdfUrl,
            generatedAt: po.pdfGeneratedAt,
            generatedBy: po.pdfGeneratedBy,
          }
          : null;

      const newPdfData = {
        pdfName: fileName,
        pdfUrl: null,
        generatedAt: now,
        generatedBy: userId,
      };

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          //status: "Generated_Downloaded",
          pdfName: fileName,
          pdfGeneratedAt: now,
          pdfGeneratedBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: poId,
          action: "Generated PDF",
          performedBy: userId,
          oldValue: oldPdfData,
          newValue: newPdfData,
        },
      });
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": Buffer.byteLength(pdfBuffer),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });

    return res.end(pdfBuffer);
  } catch (err) {
    console.error("❌ Error generating PO PDF:", err.stack || err);
    return res.status(500).json({
      success: false,
      message: "Server Error while generating PO PDF",
      error: err.message,
    });
  }
};

const sendOrResendPO = async (req, res) => {
  try {
    const { poId } = req.query;
    const userId = req?.user?.id;

    if (!poId) {
      return res
        .status(404)
        .json({ success: false, message: "PO-Id is required" });
    }

    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { select: { name: true } },
      },
    });

    if (!userData) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (userData.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only purchase department is allowed to send mail.",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { vendor: true, company: true },
    });

    if (!po)
      return res.status(404).json({ success: false, message: "PO not found" });
    if (!po.vendor.email)
      return res
        .status(400)
        .json({ success: false, message: "Vendor email missing" });
    if (!po.pdfName || !po.pdfUrl) {
      return res
        .status(400)
        .json({ success: false, message: "PDF not generated yet" });
    }

    const pdfPath = path.join(
      __dirname,
      "../../uploads/purchaseOrder",
      po.pdfName,
    );
    if (!fs.existsSync(pdfPath)) {
      return res
        .status(404)
        .json({ success: false, message: "PDF file missing on server" });
    }

    // ✅ Determine action (Send or Resend)
    const isResend = po.status === "Sent";

    // ✅ Prepare email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: po.vendor.email,
      subject: `${isResend ? "RESEND:" : ""} Purchase Order - ${po.poNumber}`,
      text: `Dear ${po.vendor.name},

${isResend ? "Resending the" : "Please find the attached"} Purchase Order.

Regards,
${po.company.name}
${po.company.state}, ${po.company.pincode}
Contact: ${po.company.contactNumber}
      `,
      attachments: [{ filename: po.pdfName, path: pdfPath }],
    };

    // ✅ Send email
    const emailResponse = await transporter.sendMail(mailOptions);
    if (!emailResponse.accepted?.length) throw new Error("Email rejected");

    console.log("Email sent:", emailResponse.messageId);

    // ✅ DB Update only after email success
    await prisma.$transaction(async (tx) => {
      if (isResend) {
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            emailResentCount: { increment: 1 },
            emailLastResentAt: new Date(),
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "PurchaseOrder",
            entityId: poId,
            action: "EMAIL_RESENT",
            performedBy: userId,
            oldValue: { resentCount: po.emailResentCount },
            newValue: { resentCount: po.emailResentCount + 1 },
          },
        });
      } else {
        await tx.purchaseOrder.update({
          where: { id: poId },
          data: {
            status: "Sent",
            emailSentAt: new Date(),
            emailSentBy: userId,
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "PurchaseOrder",
            entityId: poId,
            action: "EMAIL_SENT",
            performedBy: userId,
            oldValue: { status: po.status },
            newValue: { status: "Sent", emailTo: po.vendor.email },
          },
        });
      }
    });

    return res.status(200).json({
      success: true,
      message: isResend
        ? "PO re-emailed successfully."
        : "PO emailed successfully.",
    });
  } catch (err) {
    console.error("Email/DB Error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send PO email",
      error: err.message,
    });
  }
};

const cancelPurchaseOrder = async (req, res) => {
  try {
    const { poId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: user not logged in",
      });
    }

    if (!poId) {
      return res.status(400).json({
        success: false,
        message: "poId is required.",
      });
    }

    const userData = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: {
          select: { name: true },
        },
      },
    });

    if (!userData) {
      return res.status(404).json({
        success: false,
        message: "User data not found in database",
      });
    }

    if (userData.role.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message:
          "Only purchase department are allowed to cancel purchase orders.",
      });
    }

    const existingPO = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
    });

    if (!existingPO) {
      return res.status(404).json({
        success: false,
        message: "Purchase order not found.",
      });
    }
    if (
      existingPO.status === "Received" ||
      existingPO.status === "PartiallyReceived"
    ) {
      return res.status(400).json({
        success: false,
        message: `Purchase order status - ${existingPO.status}. Cannot be cancelled`,
      });
    }

    if (existingPO.status === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: "Purchase order is already cancelled.",
      });
    }

    // 🔥 Transaction: Cancel PO + Create Audit Log
    const [updatedPO] = await prisma.$transaction([
      prisma.purchaseOrder.update({
        where: { id: poId },
        data: {
          status: "Cancelled",
        },
      }),

      prisma.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: poId,
          action: "CANCELLED",
          performedBy: userId,
          oldValue: {
            status: existingPO.status,
          },
          newValue: {
            status: "Cancelled",
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "✅ Purchase order cancelled successfully.",
      data: updatedPO,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Error while cancelling purchase order.",
    });
  }
};

//------------Debit Note Section ---------------//
const getPurchaseOrderDetailsWithDamagedItems = async (req, res) => {
  try {
    const { poId } = req.params;

    if (!poId) {
      return res.status(400).json({
        success: false,
        message: "Purchase Order ID is required",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        id: true,
        poNumber: true,
        companyId: true,
        companyName: true,
        vendorId: true,
        vendorName: true,
        // gstType: true,
        // 🔥 THIS IS THE CHANGE
        damagedStock: {
          select: {
            id: true,
            itemId: true,
            itemSource: true,
            itemName: true,
            quantity: true,
            unit: true,
          },
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    return res.json({
      success: true,
      message: "PO details with damaged stock fetched successfully",
      data: po || [],
    });
  } catch (error) {
    console.error("❌ Error fetching PO details:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const createDebitNote = async (req, res) => {
  try {
    const {
      purchaseOrderId,
      companyId,
      vendorId,
      gstType,
      damagedItems,
      remarks,
      orgInvoiceNo,
      orgInvoiceDate,
      gr_rr_no,
      transport,
      vehicleNumber,
      station,
      currency,
      exchangeRate: requestExchangeRate = 1,
      expectedDeliveryDate,
      otherCharges = [],
    } = req.body;

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can create Debit Note.",
      });
    }

    if (
      !purchaseOrderId ||
      !companyId ||
      !vendorId ||
      !gstType ||
      !damagedItems?.length
    ) {
      return res.status(400).json({
        success: false,
        message:
          "PurchaseOrderId, Company, Vendor, GST Type & damagedItems are required",
      });
    }

    if (expectedDeliveryDate) {
      const debitNoteDateOnly = new Date();
      debitNoteDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      // if (debitNoteDateOnly.getTime() === expectedDateOnly.getTime()) {
      //   return res.status(400).json({
      //     success: false,
      //     message: "Expected Delivery Date cannot be same as PO Date",
      //   });
      // }

      if (expectedDateOnly < debitNoteDateOnly) {
        return res.status(400).json({
          success: false,
          message: "Expected Delivery Date cannot be before PO Date",
        });
      }
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: {
        id: purchaseOrderId,
      },
    });

    if (!po) {
      return res.status(400).json({
        success: false,
        message: "PO not found.",
      });
    }

    const isItemWise = gstType.includes("ITEMWISE");

    // Validate items
    for (const item of damagedItems) {
      if (
        !item.damagedStockId ||
        !item.itemId ||
        !item.name ||
        !item.source ||
        !item.unit
      ) {
        return res.status(400).json({
          success: false,
          message:
            "DamagedItems must include damagedStockId, itemId, name, source, unit",
        });
      }
      if (!item.rate || !item.quantity || Number(item.quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Each item must have valid quantity & rate",
        });
      }
      if (isItemWise && (item.gstRate == null || item.gstRate === "")) {
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST Debit Note",
        });
      }
      if (!isItemWise && item.gstRate) {
        return res.status(400).json({
          success: false,
          message:
            "gstRate is only allowed when Debit Note GST type is ITEMWISE",
        });
      }
    }

    const mongoIds = [];
    const mysqlIds = [];

    // Separate IDs by source
    for (const item of damagedItems) {
      if (!item.source) {
        return res.status(400).json({
          success: false,
          message: "item.source is required (mongo/mysql)",
        });
      }

      if (item.source === "mongo") {
        mongoIds.push(item.itemId);
      } else if (item.source === "mysql") {
        mysqlIds.push(item.itemId);
      } else {
        return res.status(400).json({
          success: false,
          message: `Invalid item.source '${item.source}'. Use 'mongo' or 'mysql'.`,
        });
      }
    }

    // Fetch all mongo items in one query
    let existingMongoItems = [];
    if (mongoIds.length) {
      existingMongoItems = await SystemItem.find({ _id: { $in: mongoIds } })
        .select("_id")
        .lean();
    }

    // Fetch all mysql items in one query
    let existingMysqlItems = [];
    if (mysqlIds.length) {
      existingMysqlItems = await prisma.rawMaterial.findMany({
        where: { id: { in: mysqlIds } },
        select: { id: true },
      });
    }

    // Convert to fast lookup sets
    const mongoSet = new Set(existingMongoItems.map((m) => String(m._id)));
    const mysqlSet = new Set(existingMysqlItems.map((m) => m.id));

    // Validate each item
    for (const item of damagedItems) {
      if (item.source === "mongo" && !mongoSet.has(item.itemId)) {
        throw new Error(`System Item with id '${item.itemId}' Not Found in`);
      }

      if (item.source === "mysql" && !mysqlSet.has(item.itemId)) {
        throw new Error(`Raw Material with id '${item.itemId}' Not Found`);
      }
    }
    // Fetch company & vendor
    const [company, vendor] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);

    if (!company || !vendor) {
      return res.status(404).json({
        success: false,
        message: "Company/Vendor not found",
      });
    }

    // Debit Note currency and exchange rate
    const finalCurrency = currency || po.currency || "INR";
    const finalExchangeRate =
      exchangeRate && Number(exchangeRate) > 0
        ? new Decimal(exchangeRate).toDecimalPlaces(4, Decimal.ROUND_DOWN)
        : new Decimal(1);

    const debitNoteNo = await generateDebitNoteNumber(company);
    if (await prisma.debitNote.findUnique({ where: { debitNoteNo } })) {
      return res.status(400).json({
        success: false,
        message: `Debit Note ${debitNoteNo} already exists`,
      });
    }

    // ------------------------------------
    // 🧮 Subtotal & GST Calculations
    // ------------------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // Process items for DB
    const processedItems = damagedItems.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      return {
        purchaseOrderId,
        itemId: item.itemId,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,
        rateInForeign: currency !== "INR" ? rateForeign : null,
        amountInForeign: currency !== "INR" ? amountForeign : null,
        rate: new Decimal(item.rate),
        gstRate: isItemWise ? new Decimal(item.gstRate) : null,
        quantity: qty,
        total: amountINR,
        itemGSTType: isItemWise ? gstType : null,
      };
    });

    // Add otherCharges to subtotal
    let otherChargesTotal = new Decimal(0);
    if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (!ch.amount || isNaN(ch.amount)) continue;
        otherChargesTotal = otherChargesTotal.plus(new Decimal(ch.amount));
      }
    }
    let inrOtherChargesTotal = 0;
    if (finalCurrency !== "INR") {
      inrOtherChargesTotal = otherChargesTotal
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    }
    subTotalINR =
      finalCurrency === "INR"
        ? subTotalINR.plus(otherChargesTotal)
        : subTotalINR.plus(inrOtherChargesTotal);

    // GST for normal items
    const debitNoteGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && debitNoteGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(debitNoteGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(debitNoteGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(debitNoteGSTPercent.div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // Item-wise GST
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotal = subTotalINR.plus(totalGST);
    const grandTotalINR = roundGrandTotal(rawGrandTotal);
    foreignSubTotal = foreignSubTotal.plus(otherChargesTotal);
    const foreignGrandTotal = foreignSubTotal.toDecimalPlaces(
      4,
      Decimal.ROUND_DOWN,
    );

    let warehouseName = po.warehouseName;
    // const warehouseData = await Warehouse.findById(warehouseId);
    // if (warehouseData) {
    //   warehouseName = warehouseData?.warehouseName;
    // }
    console.log(warehouseName);
    // ------------------------------------
    // 💾 Save Purchase Order
    // ------------------------------------
    const existingDamagedStocks = await prisma.damagedStock.findMany({
      where: {
        purchaseOrderId,
        status: "Pending",
        debitNoteId: null,
      },
    });

    if (!existingDamagedStocks.length) {
      return res.status(400).json({
        success: false,
        message: "No pending damaged stock found for this Purchase Order",
      });
    }

    const damagedStockMap = new Map();
    for (const ds of existingDamagedStocks) {
      damagedStockMap.set(`${ds.itemId}_${ds.itemSource}`, ds);
    }

    const newDebitNote = await prisma.$transaction(async (tx) => {
      const debitNote = await tx.debitNote.create({
        data: {
          debitNoteNo,
          financialYear: getFinancialYear(),
          purchaseOrderId,
          companyId,
          companyName: company.name,
          vendorId,
          vendorName: vendor.name,
          gstType,
          gstRate: debitNoteGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate,
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          fixedGrandTotal: rawGrandTotal,
          remarks,
          orgInvoiceNo: orgInvoiceNo || null,
          orgInvoiceDate: orgInvoiceDate || null,
          gr_rr_no: gr_rr_no || null,
          transport: transport || null,
          vehicleNumber: vehicleNumber || null,
          station: station || null,
          createdBy: userId,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : null,
          otherCharges: normalizedOtherCharges,
          warehouseId: po.warehouseId,
          warehouseName,
        },
      });

      // ✅ UPDATE existing DamagedStock
      for (const item of processedItems) {
        const key = `${item.itemId}_${item.itemSource}`;
        const damaged = damagedStockMap.get(key);

        if (!damaged) {
          throw new Error(`Damaged stock not found for ${item.itemName}`);
        }

        if (new Decimal(item.quantity).gt(damaged.quantity)) {
          throw new Error(
            `Debit quantity exceeds damaged quantity for ${item.itemName}`,
          );
        }

        await tx.damagedStock.update({
          where: { id: damaged.id },
          data: {
            debitNoteId: debitNote.id,
            hsnCode: item.hsnCode || null,
            modelNumber: item.modelNumber || null,
            itemDetail: item.itemDetail || null,
            rate: item.rate,
            gstRate: item.gstRate,
            rateInForeign: item.rateInForeign,
            amountInForeign: item.amountInForeign,
            total: item.total,
            itemGSTType: item.itemGSTType,
            status: "Debited",
            updatedBy: userId,
          },
        });

        await tx.auditLog.create({
          data: {
            entityType: "DamagedStock",
            entityId: damaged.id,
            action: "DEBITED",
            performedBy: userId,
            newValue: { debitNoteId: debitNote.id, status: "Debited" },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          entityType: "DebitNote",
          entityId: debitNote.id,
          action: "CREATED",
          performedBy: userId,
          newValue: debitNote,
        },
      });

      return debitNote;
    });

    return res.status(201).json({
      success: true,
      message: "✅ Debit Note created successfully",
      data: newDebitNote,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error while creating debit note",
    });
  }
};

const getDebitNoteListByPO = async (req, res) => {
  try {
    const { poId } = req.params;

    if (!poId) {
      return res.status(400).json({
        success: false,
        message: "poId is required",
      });
    }

    const userId = req.user?.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || !["Purchase", "Admin"].includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const debitNoteList = await prisma.debitNote.findMany({
      where: { purchaseOrderId: poId },
      select: {
        id: true,
        debitNoteNo: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      message: "Debit Note list fetched successfully",
      data: debitNoteList || [],
    });
  } catch (error) {
    console.error("Error fetching Debit Note list:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const downloadDebitNote = async (req, res) => {
  try {
    const { poId, debitNoteId } = req.params;
    const userId = req.user?.id;
    if (!poId || !debitNoteId) {
      return res.status(400).json({
        success: false,
        message: "Missing Data: PO Id or Debit Note Id",
      });
    }
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not found.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Only Purchase Department can generate PO.",
      });
    }

    const debitNote = await prisma.debitNote.findUnique({
      where: { id: debitNoteId, purchaseOrderId: poId },
      include: { company: true, vendor: true, damagedStock: true },
    });

    if (!debitNote) {
      return res
        .status(404)
        .json({ success: false, message: "Debit Note not found." });
    }

    // Freeze item values exactly as stored
    const items = debitNote.damagedStock.map((it) => ({
      itemName: it.itemName,
      hsnCode: it.hsnCode || "-",
      quantity: Number(it.quantity),
      modelNumber: it.modelNumber || null,
      itemDetail: it.itemDetail || null,
      unit: it.unit || "Nos",
      rate: Number(it.rate),
      total: Number(it.total),
      gstRate: it.gstRate ? Number(it.gstRate) : 0,
      rateInForeign: it.rateInForeign ? Number(it.rateInForeign) : null,
      amountInForeign: it.amountInForeign ? Number(it.amountInForeign) : null,
    }));

    const pdfBuffer = await debitNoteGenerate(debitNote, items);

    // sanitize vendor name
    const vendor = debitNote.vendor.name.split(" ")[0];
    const fileName = `${vendor}-DEBIT-${debitNote.debitNoteNo}.pdf`;

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const oldPdfData =
        debitNote.pdfUrl || debitNote.pdfName || debitNote.pdfGeneratedAt
          ? {
            pdfName: debitNote.pdfName,
            pdfUrl: debitNote.pdfUrl,
            generatedAt: debitNote.pdfGeneratedAt,
            generatedBy: debitNote.pdfGeneratedBy,
          }
          : null;

      const newPdfData = {
        pdfName: fileName,
        pdfUrl: null,
        generatedAt: now,
        generatedBy: userId,
      };

      await tx.debitNote.update({
        where: { id: debitNoteId },
        data: {
          //status: "Generated_Downloaded",
          pdfName: fileName,
          pdfGeneratedAt: now,
          pdfGeneratedBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "DebitNote",
          entityId: debitNoteId,
          action: "Generated PDF",
          performedBy: userId,
          oldValue: oldPdfData,
          newValue: newPdfData,
        },
      });
    });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": Buffer.byteLength(pdfBuffer),
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });

    return res.end(pdfBuffer);
  } catch (err) {
    console.error("❌ Error generating Debit Note PDF:", err.stack || err);
    return res.status(500).json({
      success: false,
      message: "Server Error while generating Debite Note PDF",
      error: err.message,
    });
  }
};

const getDebitNoteDetails = async (req, res) => {
  try {
    const { debitNoteId } = req.params;

    if (!debitNoteId) {
      return res.status(400).json({
        success: false,
        message: "Debit Note ID is required",
      });
    }

    const debitNote = await prisma.debitNote.findUnique({
      where: { id: debitNoteId },
      select: {
        id: true,
        purchaseOrderId: true,
        debitNoteNo: true,
        //financialYear: true,
        companyId: true,
        companyName: true,
        vendorId: true,
        vendorName: true,
        //bankDetailId: true,
        //createdBy: true,
        drNoteDate: true,
        gstType: true,
        gstRate: true,
        currency: true,
        exchangeRate: true,
        foreignSubTotal: true,
        foreignGrandTotal: true,
        subTotal: true,
        //totalCGST: true,
        //totalSGST: true,
        //totalIGST: true,
        //totalGST: true,
        grandTotal: true,
        status: true,
        remarks: true,
        //pdfUrl: true,
        //pdfName: true,
        //pdfGeneratedAt: true,
        //pdfGeneratedBy: true,
        //emailSentAt: true,
        //emailSentBy: true,
        //emailResentCount: true,
        //emailLastResentAt: true,
        orgInvoiceNo: true,
        orgInvoiceDate: true,
        gr_rr_no: true,
        transport: true,
        vehicleNumber: true,
        station: true,
        createdAt: true,
        otherCharges: true,
        //updatedAt: true,
        damagedStock: {
          select: {
            id: true,
            purchaseOrderId: true,
            debitNoteId: true,
            itemId: true,
            itemSource: true,
            itemName: true,
            hsnCode: true,
            modelNumber: true,
            itemDetail: true,
            unit: true,
            rate: true,
            gstRate: true,
            quantity: true,
            amountInForeign: true,
            receivedQty: true,
            //itemGSTType: true,
            total: true,
            //createdAt: true,
            //updatedAt: true,
          },
        },
      },
    });

    if (!debitNote) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    return res.json({
      success: true,
      message: "Debit Note details fetched successfully",
      data: debitNote,
    });
  } catch (error) {
    console.error("❌ Error fetching Debit Note details:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

//Work to do on debit note update
const updateDebitNote = async (req, res) => {
  try {
    const { debitNoteId } = req.params;
    const {
      companyId,
      vendorId,
      gstType,
      damagedItems,
      remarks,
      orgInvoiceNo,
      orgInvoiceDate,
      gr_rr_no,
      transport,
      vehicleNumber,
      station,
      otherCharges = [],
    } = req.body;

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can update PO",
      });
    }

    let normalizedOtherCharges = [];
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const existingDebitNote = await prisma.debitNote.findUnique({
      where: { id: debitNoteId },
      include: { damagedItems: true },
    });

    if (!existingDebitNote)
      return res
        .status(404)
        .json({ success: false, message: "Debit Note not found" });

    // if (existingPO.status !== "Draft") {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Only Draft PO can be updated",
    //   });
    // }

    if (!damagedItems?.length)
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });

    const isItemWise = gstType.includes("ITEMWISE");

    // Validate items
    for (const item of damagedItems) {
      if (!item.itemId || !item.name || !item.unit)
        return res.status(400).json({
          success: false,
          message: "Each item must include id, name, and unit",
        });

      if (!item.rate || !item.quantity || Number(item.quantity) <= 0)
        return res.status(400).json({
          success: false,
          message: "Each item must have valid rate and quantity",
        });

      if (isItemWise && (item.gstRate == null || item.gstRate === ""))
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });

      if (!isItemWise && item.gstRate)
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
    }

    const oldValue = JSON.parse(JSON.stringify(existingDebitNote));

    // Fetch vendor
    const vendorToUseId = existingDebitNote.vendorId;
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorToUseId },
    });

    if (!vendor)
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });

    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      finalCurrency === "INR"
        ? new Decimal(1)
        : new Decimal(exchangeRate || 1).toDecimalPlaces(4, Decimal.ROUND_DOWN);

    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // -------------------------
    // ⭐ UNIVERSAL GST LOGIC FOR EACH ITEM ⭐
    // -------------------------
    const processedItems = damagedItems.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      let itemGSTType = null;
      let itemGSTRate = null;

      const isExempted = gstType.includes("EXEMPTED");
      const isItemWiseGST = gstType.includes("ITEMWISE");

      if (isExempted) {
        // CASE 1 — EXEMPTED
        itemGSTType = null;
        itemGSTRate = null;
      } else if (isItemWiseGST) {
        // CASE 2 — ITEMWISE
        itemGSTType = gstType;
        itemGSTRate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );
      } else {
        // CASE 3 — Normal IGST/LGST 5/12/18/28
        itemGSTRate = null;
        itemGSTType = null;
      }

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,

        rateInForeign: finalCurrency !== "INR" ? rateForeign : null,
        amountInForeign: finalCurrency !== "INR" ? amountForeign : null,

        rate: new Decimal(item.rate),
        quantity: qty,

        gstRate: itemGSTRate,
        itemGSTType: itemGSTType,

        total: amountINR,
      };
    });

    // OTHER CHARGES
    let otherChargesTotal = new Decimal(0);
    if (Array.isArray(otherCharges)) {
      for (const ch of otherCharges) {
        if (ch == null) continue;
        const amt = ch.amount ?? ch.value ?? null;
        if (amt == null || isNaN(amt)) continue;
        otherChargesTotal = otherChargesTotal
          .plus(new Decimal(amt))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }
    subTotalINR = subTotalINR.plus(otherChargesTotal);

    // GST FOR NORMAL ITEMS
    const debitNoteGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && debitNoteGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(new Decimal(debitNoteGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(new Decimal(debitNoteGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(new Decimal(debitNoteGSTPercent).div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // GST FOR ITEMWISE
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotalINR = subTotalINR
      .plus(totalGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const grandTotalINR = roundGrandTotal(rawGrandTotalINR);
    const foreignGrandTotal = foreignSubTotal.toDecimalPlaces(
      4,
      Decimal.ROUND_DOWN,
    );

    // -------------------------
    // UPDATE PO
    // -------------------------
    const updatedDebitNote = await prisma.$transaction(async (tx) => {
      await tx.damagedStock.deleteMany({
        where: { purchaseOrderId: poId },
      });

      const po = await tx.debitNote.update({
        where: { id: debitNoteId },
        data: {
          companyId: companyId || existingPO.companyId,
          vendorId: vendorId || existingPO.vendorId,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate.toString(),
          foreignSubTotal,
          foreignGrandTotal,
          subTotal: subTotalINR,
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          remarks,
          orgInvoiceNo: orgInvoiceNo || existingDebitNote.orgInvoiceNo,
          orgInvoiceDate: orgInvoiceDate || existingDebitNote.orgInvoiceDate,
          gr_rr_no: gr_rr_no || existingDebitNote.gr_rr_no,
          transport: transport || existingDebitNote.transport,
          vehicleNumber: vehicleNumber || existingDebitNote.vehicleNumber,
          station: station || existingDebitNote.station,
          otherCharges: normalizedOtherCharges,
          damagedItems: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "DebitNote",
          entityId: existingDebitNote.id,
          action: "UPDATED",
          performedBy: userId,
          oldValue,
          newValue: po,
        },
      });

      return po;
    });

    res.json({
      success: true,
      message: "✅ Debit Note updated successfully",
      data: updatedPO,
    });
  } catch (err) {
    console.error("Debit Note Update Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error while updating Debit Note",
    });
  }
};

const updateDebitNote2 = async (req, res) => {
  try {
    const { debitNoteId } = req.params;
    const {
      companyId,
      vendorId,
      gstType,
      damagedItems,
      remarks,
      orgInvoiceNo,
      orgInvoiceDate,
      gr_rr_no,
      transport,
      vehicleNumber,
      station,
      otherCharges = [],
    } = req.body;

    /* ---------------- AUTH ---------------- */
    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can update Debit Note",
      });
    }

    /* ---------------- FETCH DEBIT NOTE ---------------- */
    const existingDebitNote = await prisma.debitNote.findUnique({
      where: { id: debitNoteId },
      include: { damagedStock: true },
    });

    if (!existingDebitNote)
      return res.status(404).json({
        success: false,
        message: "Debit Note not found",
      });

    if (!Array.isArray(damagedItems) || !damagedItems.length)
      return res.status(400).json({
        success: false,
        message: "At least one damaged item is required",
      });

    const oldValue = JSON.parse(JSON.stringify(existingDebitNote));

    /* ---------------- OTHER CHARGES ---------------- */
    let normalizedOtherCharges = [];
    let otherChargesTotal = new Decimal(0);

    if (
      Array.isArray(otherCharges) &&
      !(otherCharges.length === 1 && otherCharges[0]?.name === "")
    ) {
      for (const ch of otherCharges) {
        if (!ch?.name || ch.amount == null || isNaN(ch.amount)) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: each charge must have name and amount",
          });
        }

        const amt = new Decimal(ch.amount).toDecimalPlaces(4, ROUND_DOWN);
        normalizedOtherCharges.push({ name: ch.name.trim(), amount: amt });
        otherChargesTotal = otherChargesTotal.plus(amt);
      }
    }

    /* ---------------- GST FLAGS ---------------- */
    const isItemWise = gstType.includes("ITEMWISE");
    const isExempted = gstType.includes("EXEMPTED");

    /* ---------------- CURRENCY ---------------- */
    const finalCurrency = currency || existingDebitNote.currency;
    const finalExchangeRate =
      finalCurrency === "INR"
        ? new Decimal(1)
        : new Decimal(
          exchangeRate || existingDebitNote.exchangeRate,
        ).toDecimalPlaces(4, Decimal.ROUND_DOWN);

    /* ---------------- TOTALS ---------------- */
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    /* ---------------- UPDATE DAMAGED STOCK ---------------- */
    for (const item of damagedItems) {
      if (!item.damagedStockId || !item.rate) {
        return res.status(400).json({
          success: false,
          message: "damagedStockId and rate are required",
        });
      }

      const existingItem = existingDebitNote.damagedStock.find(
        (d) => d.id === item.damagedStockId,
      );

      if (!existingItem) {
        return res.status(400).json({
          success: false,
          message: "Invalid damagedStockId",
        });
      }

      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      let itemGSTType = null;
      let itemGSTRate = null;

      if (!isExempted && isItemWise) {
        itemGSTType = gstType;
        itemGSTRate = new Decimal(item.gstRate || 0).toDecimalPlaces(4);
      }

      await prisma.damagedStock.update({
        where: { id: item.damagedStockId },
        data: {
          rate: rateForeign,
          rateInForeign: finalCurrency !== "INR" ? rateForeign : null,
          amountInForeign: finalCurrency !== "INR" ? amountForeign : null,
          gstRate: itemGSTRate,
          itemGSTType,
          total: amountINR,
          updatedBy: userId,
        },
      });

      /* ---------- ITEMWISE GST ---------- */
      if (!isExempted && isItemWise) {
        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST.plus(amountINR.mul(itemGSTRate.div(200)));
          totalSGST = totalSGST.plus(amountINR.mul(itemGSTRate.div(200)));
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST.plus(amountINR.mul(itemGSTRate.div(100)));
        }
      }
    }

    /* ---------------- OTHER CHARGES ---------------- */
    subTotalINR = subTotalINR.plus(otherChargesTotal);

    /* ---------------- NORMAL GST ---------------- */
    if (!isItemWise && !isExempted) {
      const gstPercent = getGSTPercent(gstType);
      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST.plus(subTotalINR.mul(gstPercent / 200));
        totalSGST = totalSGST.plus(subTotalINR.mul(gstPercent / 200));
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST.plus(subTotalINR.mul(gstPercent / 100));
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4);
    const grandTotal = roundGrandTotal(subTotalINR.plus(totalGST));

    /* ---------------- UPDATE DEBIT NOTE ---------------- */
    const updatedDebitNote = await prisma.$transaction(async (tx) => {
      const dn = await tx.debitNote.update({
        where: { id: debitNoteId },
        data: {
          companyId: companyId ?? undefined,
          vendorId: vendorId ?? undefined,
          gstType,
          subTotal: subTotalINR,
          foreignSubTotal,
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal,
          foreignGrandTotal: foreignSubTotal,
          remarks,
          orgInvoiceNo: orgInvoiceNo ?? undefined,
          orgInvoiceDate: orgInvoiceDate ?? undefined,
          gr_rr_no: gr_rr_no ?? undefined,
          transport: transport ?? undefined,
          vehicleNumber: vehicleNumber ?? undefined,
          station: station ?? undefined,
          otherCharges: normalizedOtherCharges,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "DebitNote",
          entityId: debitNoteId,
          action: "UPDATED",
          performedBy: userId,
          oldValue,
          newValue: dn,
        },
      });

      return dn;
    });

    return res.json({
      success: true,
      message: "✅ Debit Note updated successfully",
      data: updatedDebitNote,
    });
  } catch (err) {
    console.error("Debit Note Update Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error",
    });
  }
};

const debitNoteReceivingBill = async (req, res) => {
  const userId = req.user?.id;
  let uploadedFilePath = null;

  const deleteUploadedFile = () => {
    if (uploadedFilePath) {
      try {
        fs.unlinkSync(uploadedFilePath);
        console.log("🗑️ Uploaded bill file deleted due to error.");
      } catch (err) {
        console.error("⚠️ File delete failed:", err);
      }
    }
  };

  try {
    // Parse items JSON
    if (req.body.items) {
      try {
        req.body.items = JSON.parse(req.body.items);
      } catch (err) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid JSON format for items." });
      }
    }

    const {
      purchaseOrderId,
      debitNoteId,
      damagedItems,
      warehouseId,
      invoiceNumber,
    } = req.body;
    const billFile = req.files?.billFile?.[0];

    if (
      !purchaseOrderId ||
      !debitNoteId ||
      !Array.isArray(damagedItems) ||
      items.length === 0 ||
      !warehouseId ||
      !billFile
    ) {
      return res.status(400).json({
        success: false,
        message: "warehouseId, items[] and a single bill file are required.",
      });
    }

    uploadedFilePath = path.join(
      __dirname,
      "../../uploads/debitNote/receivingBill",
      billFile.filename,
    );

    // let purchaseOrderId = null;
    // let debitNoteId = null;

    const stockUpdates = []; // collect stock updates to perform later

    const receiptResults = await prisma.$transaction(async (tx) => {
      const results = [];

      // Use the first item's damagedStock to get PO & DebitNote
      // const firstDamaged = await tx.damagedStock.findUnique({
      //   where: { id: items[0].damagedStockId },
      // });

      // if (!firstDamaged) throw new Error("Damaged stock not found");
      // purchaseOrderId = firstDamaged.purchaseOrderId;
      // debitNoteId = firstDamaged.debitNoteId;

      // 1️⃣ Create a single bill for the debit note
      await tx.damagedStockBill.create({
        data: {
          debitNoteId,
          fileName: billFile.filename,
          fileUrl: `/uploads/debitNote/receivingBill/${billFile.filename}`,
          mimeType: billFile.mimetype,
          uploadedBy: userId,
          invoiceNumber: invoiceNumber || null,
        },
      });

      // 2️⃣ Process each damaged stock item
      for (const item of damagedItems) {
        const {
          damagedStockId,
          goodQty = 0,
          damagedQty = 0,
          remarks = "",
        } = item;

        const damaged = await tx.damagedStock.findUnique({
          where: { id: damagedStockId },
          include: {
            purchaseOrder: { include: { items: true } },
          },
        });

        if (!damaged) throw new Error("Damaged stock not found");
        if (damaged.status === "Resolved")
          throw new Error("Damaged stock already resolved");

        const remainingQty =
          Number(damaged.quantity) - Number(damaged.receivedQty || 0);
        if (goodQty > remainingQty)
          throw new Error(
            "Total received quantity exceeds pending damaged quantity",
          );

        // Update damaged stock
        const newReceivedQty = Number(damaged.receivedQty || 0) + goodQty;
        const newStatus =
          newReceivedQty >= Number(damaged.quantity) ? "Resolved" : "Pending";

        await tx.damagedStock.update({
          where: { id: damagedStockId },
          data: {
            receivedQty: newReceivedQty,
            status: newStatus,
            remarks,
            updatedBy: userId,
          },
        });

        const poItem = damaged.purchaseOrder.items.find(
          (i) =>
            i.itemId === damaged.itemId && i.itemSource === damaged.itemSource,
        );

        if (!poItem) throw new Error("Purchase order item not found");

        const poQty = Number(poItem.quantity);
        const alreadyReceived = Number(poItem.receivedQty || 0);

        // ❗ CRITICAL VALIDATION
        if (alreadyReceived >= poQty) {
          throw new Error(
            `${damaged.itemName} already fully received (${poQty}).`,
          );
        }

        if (alreadyReceived + goodQty > poQty) {
          throw new Error(
            `Cannot receive goodQty ${goodQty} for ${damaged.itemName}. 
     Only ${poQty - alreadyReceived} quantity can be received.`,
          );
        }

        if (goodQty > 0) {
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: { receivedQty: { increment: goodQty } },
          });

          // Collect stock updates for later
          stockUpdates.push({
            itemSource: damaged.itemSource,
            itemId: damaged.itemId,
            qty: goodQty,
            warehouseId,
            unit: damaged.unit?.toLowerCase(),
          });
        }

        results.push({
          damagedStockId,
          itemName: damaged.itemName,
          goodQty,
          damagedQty,
          remainingQty: Number(damaged.quantity) - newReceivedQty,
          status: newStatus,
          debitNoteId,
        });
      }

      // 3️⃣ Auto-close Debit Note & PO if all damages resolved
      const pendingDamageCount = await tx.damagedStock.count({
        where: { purchaseOrderId, status: "Pending" },
      });

      if (pendingDamageCount === 0) {
        await tx.debitNote.updateMany({
          where: { purchaseOrderId, status: "Pending" },
          data: { status: "Received", updatedBy: userId },
        });

        await tx.purchaseOrder.update({
          where: { id: purchaseOrderId },
          data: { status: "Received", updatedBy: userId },
        });
      }

      return results;
    });

    // 4️⃣ Update stock outside transaction
    for (const s of stockUpdates) {
      const { itemSource, itemId, qty, warehouseId, unit } = s;

      if (itemSource === "mongo") {
        const inventoryItem = await InstallationInventory.findOne({
          warehouseId,
          systemItemId: itemId,
        });
        if (inventoryItem) {
          inventoryItem.quantity += qty;
          await inventoryItem.save();
        } else {
          await InstallationInventory.create({
            warehouseId,
            systemItemId: itemId,
            quantity: qty,
          });
        }
      } else if (itemSource === "mysql") {
        const rawMat = await prisma.rawMaterial.findUnique({
          where: { id: itemId },
        });
        if (!rawMat) throw new Error(`RawMaterial ${itemId} not found.`);
        const dbUnit = rawMat.unit?.toLowerCase();
        const convertedQty =
          dbUnit === unit ? qty : convertUnit(qty, unit, dbUnit);
        await prisma.rawMaterial.update({
          where: { id: itemId },
          data: { stock: { increment: convertedQty } },
        });
      }
    }

    return res.status(200).json({
      success: true,
      message:
        "Damaged stock receipt completed with single bill and stock updated",
      data: receiptResults,
    });
  } catch (error) {
    console.error("Damaged receipt error:", error);
    deleteUploadedFile();
    return res.status(400).json({
      success: false,
      message: error.message || "Damaged stock receipt failed",
    });
  }
};

function getFinancialYearRange() {
  const now = getISTDate();

  const year = now.getFullYear();
  const month = now.getMonth(); // April = 3

  const fyStartYear = month < 3 ? year - 1 : year;

  return {
    startFY: new Date(fyStartYear, 3, 1),
    endFY: new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999),
  };
}

function getDateRanges() {
  const now = getISTDate();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + mondayOffset);
  startOfWeek.setHours(0, 0, 0, 0);

  const { startFY, endFY } = getFinancialYearRange();

  return { startOfToday, startOfMonth, startOfWeek, startFY, endFY };
}

// const getPODashboard = async (req, res) => {
//   try {
//     const { startOfToday, startOfMonth, startOfWeek, startFY, endFY } =
//       getDateRanges();

//     const statusFilter = {
//       NOT: {
//         status: "Cancelled",
//       },
//     };

//     // ------------------------------ FASTEST VERSION ------------------------------
//     const [counts, spend] = await Promise.all([
//       // Single count query (MySQL evaluates all conditions internally)
//       prisma.purchaseOrder.findMany({
//         select: { createdAt: true },
//       }),

//       // Single spend sum query
//       prisma.purchaseOrder.findMany({
//         select: { createdAt: true, grandTotal: true },
//       }),
//     ]);

//     // -------------------------------- PROCESS DATA --------------------------------
//     let poStats = {
//       total: 0,
//       yearly: 0,
//       monthly: 0,
//       weekly: 0,
//       today: 0,
//     };

//     let spendStats = {
//       total: 0,
//       yearly: 0,
//       monthly: 0,
//       weekly: 0,
//       today: 0,
//     };

//     counts.forEach((po) => {
//       const d = po.createdAt;

//       poStats.total++;

//       if (d >= startFY && d <= endFY) poStats.yearly++;
//       if (d >= startOfMonth) poStats.monthly++;
//       if (d >= startOfWeek) poStats.weekly++;
//       if (d >= startOfToday) poStats.today++;
//     });

//     spend.forEach((po) => {
//       const d = po.createdAt;
//       const amount = Number(po.grandTotal);

//       spendStats.total += amount;

//       if (d >= startFY && d <= endFY) spendStats.yearly += amount;
//       if (d >= startOfMonth) spendStats.monthly += amount;
//       if (d >= startOfWeek) spendStats.weekly += amount;
//       if (d >= startOfToday) spendStats.today += amount;
//     });

//     // ------------------------------------------------------------------------------
//     return res.status(200).json({
//       success: true,
//       message: "PO dashboard stats fetched successfully",
//       data: {
//         poStats,
//         spendStats,
//       },
//     });
//   } catch (error) {
//     console.error("Dashboard Error:", error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || "Internal Server Error",
//     });
//   }
// };

const getPODashboard = async (req, res) => {
  try {
    const { startOfToday, startOfMonth, startOfWeek, startFY, endFY } =
      getDateRanges();

    const statusFilter = {
      NOT: {
        status: "Cancelled",
      },
    };

    // ------------------------------ FASTEST VERSION ------------------------------
    const [counts, spend] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: statusFilter,
        select: { createdAt: true },
      }),

      prisma.purchaseOrder.findMany({
        where: statusFilter,
        select: { createdAt: true, grandTotal: true },
      }),
    ]);

    // -------------------------------- PROCESS DATA --------------------------------
    let poStats = {
      total: 0,
      yearly: 0,
      monthly: 0,
      weekly: 0,
      today: 0,
    };

    let spendStats = {
      total: 0,
      yearly: 0,
      monthly: 0,
      weekly: 0,
      today: 0,
    };

    counts.forEach((po) => {
      const d = po.createdAt;

      poStats.total++;

      if (d >= startFY && d <= endFY) poStats.yearly++;
      if (d >= startOfMonth) poStats.monthly++;
      if (d >= startOfWeek) poStats.weekly++;
      if (d >= startOfToday) poStats.today++;
    });

    spend.forEach((po) => {
      const d = po.createdAt;
      const amount = Number(po.grandTotal);

      spendStats.total += amount;

      if (d >= startFY && d <= endFY) spendStats.yearly += amount;
      if (d >= startOfMonth) spendStats.monthly += amount;
      if (d >= startOfWeek) spendStats.weekly += amount;
      if (d >= startOfToday) spendStats.today += amount;
    });

    // ------------------------------------------------------------------------------
    return res.status(200).json({
      success: true,
      message: "PO dashboard stats fetched successfully",
      data: {
        poStats,
        spendStats,
      },
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const createWarehouse = async (req, res) => {
  const { warehouseName } = req.body;
  const createdBy = req.user?.id;

  if (!warehouseName) {
    return res.status(400).json({
      success: false,
      message: "Warehouse name is required",
    });
  }

  try {
    // ---------- CHECK EXISTING ----------
    const trimmedWarehouseName = warehouseName.trim();
    const existingWarehouse = await Warehouse.findOne({
      warehouseName: trimmedWarehouseName,
    });

    if (existingWarehouse) {
      return res.status(400).json({
        success: false,
        message: "Warehouse already exists",
      });
    }

    // ---------- CREATE WAREHOUSE ----------
    const savedWarehouse = await new Warehouse({
      warehouseName: trimmedWarehouseName,
    }).save();

    const warehouseId = savedWarehouse._id.toString();

    // ======================================================
    // 1️⃣ RAW MATERIAL → WAREHOUSE STOCK (MYSQL) [FAST]
    // ======================================================
    const [rawMaterials, existingStocks] = await Promise.all([
      prisma.rawMaterial.findMany({
        select: { id: true, unit: true, isUsed: true },
      }),
      prisma.warehouseStock.findMany({
        where: { warehouseId },
        select: { id: true, rawMaterialId: true, isUsed: true },
      }),
    ]);

    const stockMap = new Map();
    existingStocks.forEach((s) => {
      stockMap.set(s.rawMaterialId, s);
    });

    const createData = [];
    const updatePromises = [];

    for (const rm of rawMaterials) {
      const stock = stockMap.get(rm.id);

      if (!stock) {
        // 🆕 create missing
        createData.push({
          warehouseId,
          rawMaterialId: rm.id,
          quantity: 0,
          unit: rm.unit,
          isUsed: rm.isUsed,
        });
      } else if (stock.isUsed !== rm.isUsed) {
        // 🔁 update ONLY isUsed
        updatePromises.push(
          prisma.warehouseStock.update({
            where: { id: stock.id },
            data: { isUsed: rm.isUsed },
          }),
        );
      }
    }

    if (createData.length) {
      await prisma.warehouseStock.createMany({
        data: createData,
        skipDuplicates: true,
      });
    }

    if (updatePromises.length) {
      await Promise.all(updatePromises);
    }

    // ======================================================
    // 2️⃣ SYSTEM ITEM → INSTALLATION INVENTORY (MONGODB)
    // ======================================================
    const systemItems = await SystemItem.find({}, { _id: 1 });

    if (systemItems.length) {
      await InstallationInventory.insertMany(
        systemItems.map((item) => ({
          warehouseId: savedWarehouse._id,
          systemItemId: item._id,
          quantity: 0,
          createdBy,
        })),
        { ordered: false },
      );
    }

    return res.status(200).json({
      success: true,
      message: "Warehouse added and inventories initialized",
      data: savedWarehouse,
    });
  } catch (error) {
    console.error("Add Warehouse Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getWarehouses = async (req, res) => {
  try {
    const allWarehouses = await Warehouse.find({
      warehouseName: {
        $nin: [
          "Sirsa",
          "Hisar",
          "Jind",
          "Fatehabad",
          "Maharashtra Warehouse - Ambad",
        ],
      },
    }).select("_id warehouseName");

    if (allWarehouses.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Warehouses Found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data Fetched Successfully",
      data: allWarehouses || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const getSystems = async (req, res) => {
  try {
    const systems = await System.find({}).select("_id systemName").lean();

    if (!systems || systems.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Systems not found.",
      });
    }

    const modifiedData = systems
      .map((system) => ({
        id: system._id.toString(),
        name: system.systemName,
        sortKey: parseInt(system.systemName, 10) || 0,
      }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ sortKey, ...rest }) => rest); // remove sortKey from response

    return res.status(200).json({
      success: true,
      data: modifiedData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

// const uploadTermsFromExcel = async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "Excel file required",
//       });
//     }

//     // READ BUFFER (no file saved)
//     const workbook = xlsx.read(req.file.buffer, { type: "buffer" });

//     const sheetName = workbook.SheetNames[0];
//     const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

//     if (!rows.length) {
//       return res.status(400).json({
//         success: false,
//         message: "Excel is empty",
//       });
//     }

//     let heading = null;
//     const terms = [];

//     for (const row of rows) {
//       if (!heading && row.heading) {
//         heading = String(row.heading).trim();
//       }

//       if (row.terms) {
//         terms.push(String(row.terms).trim());
//       }
//     }

//     if (!heading)
//       return res
//         .status(400)
//         .json({ success: false, message: "Heading missing" });

//     if (!terms.length)
//       return res
//         .status(400)
//         .json({ success: false, message: "No terms found" });

//     // INSERT
//     const data = await prisma.terms_Conditions.create({
//       data: {
//         heading,
//         terms,
//         createdBy: req.user?.id,
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Terms imported successfully",
//       data,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

const uploadTermsFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file required",
      });
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
    });

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "Excel is empty",
      });
    }

    let heading = null;
    const terms = [];

    for (const row of rows) {
      const normalizedRow = {};
      Object.keys(row).forEach((key) => {
        normalizedRow[key.trim().toLowerCase()] = row[key];
      });

      if (!heading && normalizedRow.heading) {
        heading = String(normalizedRow.heading).trim();
      }

      // Only require term
      if (normalizedRow.term) {
        terms.push({
          termHeading: normalizedRow.termheading
            ? String(normalizedRow.termheading).trim()
            : "",
          term: String(normalizedRow.term).trim(),
        });
      }
    }

    if (!heading) {
      return res.status(400).json({
        success: false,
        message: "Heading missing",
      });
    }

    if (!terms.length) {
      return res.status(400).json({
        success: false,
        message: "No terms found",
      });
    }

    const data = await prisma.terms_Conditions.create({
      data: {
        heading,
        terms,
        createdBy: req.user?.id,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Terms imported successfully",
      data,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const addTermCondition = async (req, res) => {
  try {
    const { term } = req.body;
    const userId = req.user?.id;

    if (!term || !term.trim()) {
      return res.status(400).json({
        success: false,
        message: "Term is required",
      });
    }

    const newTerm = await prisma.terms_Conditions.create({
      data: {
        term: term.trim(),
        createdBy: userId,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Term added successfully",
      data: newTerm,
    });
  } catch (error) {
    console.error("Add Term Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const toggleTermConditionStatus = async (req, res) => {
  try {
    const { id, isActive } = req.query;
    const userId = req.user?.id;

    if (!id || typeof isActive === "undefined") {
      return res.status(400).json({
        success: false,
        message: "Term ID and isActive flag are required",
      });
    }

    const isActiveBoolean = isActive === "true";

    const existingTerm = await prisma.terms_Conditions.findUnique({
      where: { id },
    });

    if (!existingTerm) {
      return res.status(404).json({
        success: false,
        message: "Term not found",
      });
    }

    if (existingTerm.isActive === isActiveBoolean) {
      return res.status(400).json({
        success: false,
        message: `Term is already ${isActiveBoolean ? "Active" : "Inactive"}`,
      });
    }

    const updatedTerm = await prisma.terms_Conditions.update({
      where: { id },
      data: {
        isActive: isActiveBoolean,
        updatedBy: userId,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Term ${isActiveBoolean ? "Activated" : "Deactivated"
        } successfully`,
      data: updatedTerm,
    });
  } catch (error) {
    console.error("Toggle Term Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getAllTerms = async (req, res) => {
  try {
    const terms = await prisma.terms_Conditions.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        heading: true,
        terms: true,
        isActive: true,
      },
    });

    return res.status(200).json({
      success: true,
      count: terms.length,
      data: terms,
    });
  } catch (error) {
    console.error("Error fetching all terms:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getActiveTerms = async (req, res) => {
  try {
    const terms = await prisma.terms_Conditions.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        term: true,
      },
    });

    return res.status(200).json({
      success: true,
      count: terms.length,
      data: terms,
    });
  } catch (error) {
    console.error("Error fetching terms:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getSystemDashboardData = async (req, res) => {
  try {
    const data = await getDashboardService(
      req.params.systemId,
      req.params.warehouseId,
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const formatStock = (value) => {
  if (value % 1 === 0) {
    return value; // integer → return as it is
  }
  return Number(value.toFixed(2)); // decimals → 2 digits
};

const getRawMaterialByWarehouse = async (req, res) => {
  try {
    const warehouseId = req.query?.warehouseId || req.user?.warehouseId;
    if (!warehouseId) {
      return res.status(400).json({
        success: false,
        message: "warehouseId not found",
      });
    }
    const warehouseData = await Warehouse.findById(warehouseId);
    if (!warehouseData) {
      return res.status(400).json({
        success: false,
        message: "Warehouse Not Found",
      });
    }

    const allRawMaterial = await prisma.rawMaterial.findMany({
      select: {
        id: true,
        name: true,
        unit: true,
        conversionUnit: true,
        warehouseStock: {
          where: {
            warehouseId,
          },
          select: {
            quantity: true,
            isUsed: true,
          },
        },
      },
    });

    

    const formattedData = allRawMaterial.map((data) => {
      const warehouseData = data.warehouseStock[0] || {};

      const stock = warehouseData.quantity ?? 0;
      const isUsed = warehouseData.isUsed ?? false;

      return {
        id: data.id,
        name: data.name,
        stock: formatStock(stock),
        rawStock: stock, // only for sorting
        unit: data.unit,
        conversionUnit: data.conversionUnit ? data?.conversionUnit : null,
        isUsed,
        outOfStock: stock === 0,
      };
    });

    const sortedData = formattedData.sort((a, b) => {
      // Step 1: In-stock first, out-of-stock last
      if (a.outOfStock !== b.outOfStock) {
        return a.outOfStock ? 1 : -1;
      }

      // Step 2: Then sort by isUsed
      if (a.isUsed !== b.isUsed) {
        return a.isUsed ? -1 : 1;
      }

      // Step 3: Then sort by stock quantity
      return a.rawStock - b.rawStock;
    });

    const cleanedData = sortedData.map(({ rawStock, ...rest }) => rest);

    return res.status(200).json({
      success: true,
      message: `${warehouseData.warehouseName} raw material fetched successfully`,
      data: cleanedData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

//---------------------- Vendor API - V2 --------------------//

const getPODashboard2 = async (req, res) => {
  try {
    const { startOfToday, startOfMonth, startOfWeek, startFY, endFY } =
      getDateRanges();

    // ------------------------------ FASTEST VERSION ------------------------------
    const [activePOs, cancelledPOs, groupedCurrency] = await Promise.all([
      // 1️⃣ Active (NOT Cancelled)
      prisma.purchaseOrder.findMany({
        where: { NOT: { status: "Cancelled" } },
        select: { createdAt: true, grandTotal: true, currency: true },
      }),

      // 2️⃣ Cancelled Count
      prisma.purchaseOrder.count({
        where: { status: "Cancelled" },
      }),

      // 3️⃣ Spend grouped by currency (Active only)
      prisma.purchaseOrder.groupBy({
        by: ["currency"],
        where: { NOT: { status: "Cancelled" } },
        _sum: { grandTotal: true },
        _count: { grandTotal: true },
      }),
    ]);

    // -------------------------------- PROCESS DATA --------------------------------
    let poStats = {
      total: 0,
      yearly: 0,
      monthly: 0,
      weekly: 0,
      today: 0,
    };

    let spendStats = {
      total: 0,
      yearly: 0,
      monthly: 0,
      weekly: 0,
      today: 0,
    };

    activePOs.forEach((po) => {
      const d = po.createdAt;

      const rawForeign = Number(po.foreignGrandTotal || po.grandTotal);
      const amtINR = Number(po.grandTotal); // already converted to INR

      poStats.total++;
      spendStats.total += rawForeign;
      foreignSpendStats.total += amtINR;

      if (d >= startFY && d <= endFY) {
        poStats.yearly++;
        spendStats.yearly += rawForeign;
        foreignSpendStats.yearly += amtINR;
      }
      if (d >= startOfMonth) {
        poStats.monthly++;
        spendStats.monthly += rawForeign;
        foreignSpendStats.monthly += amtINR;
      }
      if (d >= startOfWeek) {
        poStats.weekly++;
        spendStats.weekly += rawForeign;
        foreignSpendStats.weekly += amtINR;
      }
      if (d >= startOfToday) {
        poStats.today++;
        spendStats.today += rawForeign;
        foreignSpendStats.today += amtINR;
      }
    });

    const currencySummary = groupedCurrency.map((row) => ({
      currency: row.currency,
      totalSpend: Number(row._sum.grandTotal || 0),
      totalPOs: row._count.grandTotal,
    }));

    // ------------------------------------------------------------------------------
    return res.status(200).json({
      success: true,
      message: "PO dashboard stats fetched successfully",
      data: {
        poStats,
        spendStats,
        cancelledCount: cancelledPOs,
        currencySummary,
      },
    });
  } catch (error) {
    console.error("Dashboard Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const createVendor = async (req, res) => {
  let uploadedFiles = []; // keep raw disk paths to delete on failure

  try {
    const {
      name,
      email,
      gstNumber,
      address,
      city,
      state,
      pincode,
      zipCode,
      country,
      currency,
      exchangeRate,
      contactPerson,
      contactNumber,
      alternateNumber,
      vendorAadhaar,
      vendorPanCard,
      bankName,
      accountHolder,
      accountNumber,
      ifscCode,
      referenceBy,
    } = req.body;

    const performedBy = req.user?.id;

    if (
      !name ||
      !address ||
      !contactPerson ||
      !contactNumber ||
      !country ||
      !currency
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided.",
      });
    }

    const upperCaseName = name ? name.trim() : null;
    const upperCaseGST = gstNumber ? gstNumber.toUpperCase().trim() : "";
    const upperCaseAddress = address ? address.trim() : null;
    const lowerCaseEmail = email ? email?.trim()?.toLowerCase() : null;

    let aadhaarUrl = null;
    let pancardUrl = null;

    // === HANDLE FILES ===
    if (req.files?.aadhaarFile?.[0]) {
      const file = req.files.aadhaarFile[0];
      uploadedFiles.push(file.path);

      const cleanPath = file.path.replace(/\\/g, "/").split("uploads/")[1];
      aadhaarUrl = `/uploads/${cleanPath}`;
    }

    if (req.files?.pancardFile?.[0]) {
      const file = req.files.pancardFile[0];
      uploadedFiles.push(file.path);

      const cleanPath = file.path.replace(/\\/g, "/").split("uploads/")[1];
      pancardUrl = `/uploads/${cleanPath}`;
    }

    const existingVendor = await prisma.vendor.findFirst({
      where: { gstNumber: upperCaseGST },
    });

    if (existingVendor) {
      uploadedFiles.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
      return res.status(400).json({
        success: false,
        message: `Vendor with GST '${upperCaseGST}' already exists.`,
      });
    }

    const allowedCountries = [
      "AFGHANISTAN",
      "ALBANIA",
      "ALGERIA",
      "ANDORRA",
      "ANGOLA",
      "ANTIGUA AND BARBUDA",
      "ARGENTINA",
      "ARMENIA",
      "AUSTRALIA",
      "AUSTRIA",
      "AZERBAIJAN",
      "BAHAMAS",
      "BAHRAIN",
      "BANGLADESH",
      "BARBADOS",
      "BELARUS",
      "BELGIUM",
      "BELIZE",
      "BENIN",
      "BHUTAN",
      "BOLIVIA",
      "BOSNIA AND HERZEGOVINA",
      "BOTSWANA",
      "BRAZIL",
      "BRUNEI",
      "BULGARIA",
      "BURKINA FASO",
      "BURUNDI",
      "CAMBODIA",
      "CAMEROON",
      "CANADA",
      "CAPE VERDE",
      "CENTRAL AFRICAN REPUBLIC",
      "CHAD",
      "CHILE",
      "CHINA",
      "COLOMBIA",
      "COMOROS",
      "CONGO",
      "COSTA RICA",
      "CROATIA",
      "CUBA",
      "CYPRUS",
      "CZECH REPUBLIC",
      "DENMARK",
      "DJIBOUTI",
      "DOMINICA",
      "DOMINICAN REPUBLIC",
      "ECUADOR",
      "EGYPT",
      "EL SALVADOR",
      "ERITREA",
      "ESTONIA",
      "ESWATINI",
      "ETHIOPIA",
      "FIJI",
      "FINLAND",
      "FRANCE",
      "GABON",
      "GAMBIA",
      "GEORGIA",
      "GERMANY",
      "GHANA",
      "GREECE",
      "GRENADA",
      "GUATEMALA",
      "GUINEA",
      "GUINEA-BISSAU",
      "GUYANA",
      "HAITI",
      "HONDURAS",
      "HONG KONG",
      "HUNGARY",
      "ICELAND",
      "INDIA",
      "INDONESIA",
      "IRAN",
      "IRAQ",
      "IRELAND",
      "ISRAEL",
      "ITALY",
      "JAMAICA",
      "JAPAN",
      "JORDAN",
      "KAZAKHSTAN",
      "KENYA",
      "KUWAIT",
      "KYRGYZSTAN",
      "LAOS",
      "LATVIA",
      "LEBANON",
      "LESOTHO",
      "LIBERIA",
      "LIBYA",
      "LIECHTENSTEIN",
      "LITHUANIA",
      "LUXEMBOURG",
      "MADAGASCAR",
      "MALAWI",
      "MALAYSIA",
      "MALDIVES",
      "MALI",
      "MALTA",
      "MAURITIUS",
      "MEXICO",
      "MOLDOVA",
      "MONACO",
      "MONGOLIA",
      "MONTENEGRO",
      "MOROCCO",
      "MOZAMBIQUE",
      "MYANMAR",
      "NAMIBIA",
      "NEPAL",
      "NETHERLANDS",
      "NEW ZEALAND",
      "NICARAGUA",
      "NIGER",
      "NIGERIA",
      "NORTH KOREA",
      "NORWAY",
      "OMAN",
      "PAKISTAN",
      "PALAU",
      "PANAMA",
      "PAPUA NEW GUINEA",
      "PARAGUAY",
      "PERU",
      "PHILIPPINES",
      "POLAND",
      "PORTUGAL",
      "QATAR",
      "ROMANIA",
      "RUSSIA",
      "RWANDA",
      "SAUDI ARABIA",
      "SENEGAL",
      "SERBIA",
      "SEYCHELLES",
      "SIERRA LEONE",
      "SINGAPORE",
      "SLOVAKIA",
      "SLOVENIA",
      "SOMALIA",
      "SOUTH AFRICA",
      "SOUTH KOREA",
      "SPAIN",
      "SRI LANKA",
      "SUDAN",
      "SURINAME",
      "SWEDEN",
      "SWITZERLAND",
      "SYRIA",
      "TAIWAN",
      "TAJIKISTAN",
      "TANZANIA",
      "THAILAND",
      "TOGO",
      "TRINIDAD AND TOBAGO",
      "TUNISIA",
      "TURKEY",
      "UGANDA",
      "UKRAINE",
      "UNITED ARAB EMIRATES",
      "UNITED KINGDOM",
      "UNITED STATES",
      "URUGUAY",
      "UZBEKISTAN",
      "VATICAN CITY",
      "VENEZUELA",
      "VIETNAM",
      "YEMEN",
      "ZAMBIA",
      "ZIMBABWE",
    ];

    const allowedCurrencies = [
      "AED",
      "AFN",
      "ALL",
      "AMD",
      "AOA",
      "ARS",
      "AUD",
      "AZN",
      "BAM",
      "BBD",
      "BDT",
      "BHD",
      "BIF",
      "BMD",
      "BND",
      "BOB",
      "BRL",
      "BSD",
      "BTN",
      "BWP",
      "BYN",
      "CAD",
      "CDF",
      "CHF",
      "CLP",
      "CNY",
      "COP",
      "CRC",
      "CUP",
      "CVE",
      "CZK",
      "DJF",
      "DKK",
      "DOP",
      "DZD",
      "EGP",
      "ERN",
      "ETB",
      "EUR",
      "FJD",
      "GBP",
      "GEL",
      "GHS",
      "GMD",
      "GNF",
      "GTQ",
      "GYD",
      "HKD",
      "HNL",
      "HTG",
      "HUF",
      "IDR",
      "ILS",
      "INR",
      "IQD",
      "IRR",
      "ISK",
      "JMD",
      "JOD",
      "JPY",
      "KES",
      "KGS",
      "KHR",
      "KMF",
      "KPW",
      "KRW",
      "KWD",
      "KZT",
      "LAK",
      "LBP",
      "LKR",
      "LRD",
      "LSL",
      "LYD",
      "MAD",
      "MDL",
      "MGA",
      "MMK",
      "MNT",
      "MOP",
      "MRU",
      "MUR",
      "MVR",
      "MWK",
      "MXN",
      "MYR",
      "MZN",
      "NAD",
      "NGN",
      "NIO",
      "NOK",
      "NPR",
      "NZD",
      "OMR",
      "PAB",
      "PEN",
      "PGK",
      "PHP",
      "PKR",
      "PLN",
      "PYG",
      "QAR",
      "RON",
      "RSD",
      "RUB",
      "RWF",
      "SAR",
      "SCR",
      "SDG",
      "SEK",
      "SGD",
      "SLL",
      "SOS",
      "SRD",
      "SSP",
      "STN",
      "SYP",
      "SZL",
      "THB",
      "TJS",
      "TMT",
      "TND",
      "TOP",
      "TRY",
      "TTD",
      "TWD",
      "TZS",
      "UAH",
      "UGX",
      "USD",
      "UYU",
      "UZS",
      "VES",
      "VND",
      "VUV",
      "WST",
      "XAF",
      "XCD",
      "XOF",
      "XPF",
      "YER",
      "ZAR",
      "ZMW",
      "ZWL",
    ];

    if (!allowedCountries.includes(country)) {
      uploadedFiles.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
      return res.status(400).json({
        success: false,
        message: `Invalid country. Allowed: ${allowedCountries.join(", ")}`,
      });
    }

    if (!allowedCurrencies.includes(currency)) {
      uploadedFiles.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
      return res.status(400).json({
        success: false,
        message: `Invalid currency. Allowed: ${allowedCurrencies.join(", ")}`,
      });
    }

    // === TRANSACTION ===
    const vendor = await prisma.$transaction(async (tx) => {
      const newVendor = await tx.vendor.create({
        data: {
          name: upperCaseName,
          email: lowerCaseEmail,
          gstNumber: gstNumber ? upperCaseGST : null,
          address: upperCaseAddress,
          city,
          state,
          pincode: pincode ? pincode.trim() : null,
          zipCode: zipCode ? zipCode.trim() : null,
          country,
          currency,
          exchangeRate: exchangeRate ? exchangeRate : null,
          contactPerson,
          contactNumber,
          alternateNumber: alternateNumber || null,
          vendorAadhaar: vendorAadhaar ? vendorAadhaar?.trim() : null,
          aadhaarUrl: aadhaarUrl || null,
          vendorPanCard: vendorPanCard
            ? vendorPanCard?.trim()?.toUpperCase()
            : null,
          pancardUrl: pancardUrl || null,
          bankName: bankName ? bankName?.trim() : null,
          accountHolder: accountHolder ? accountHolder?.trim() : null,
          accountNumber: accountNumber ? accountNumber?.trim() : null,
          ifscCode: ifscCode ? ifscCode?.trim()?.toUpperCase() : null,
          referenceBy: referenceBy ? referenceBy.trim() : null,
          createdBy: performedBy,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "Vendor",
          entityId: newVendor.id,
          action: "Created",
          performedBy,
          oldValue: null,
          newValue: newVendor,
        },
      });

      return newVendor;
    });

    return res.status(201).json({
      success: true,
      message: "Vendor created successfully.",
      data: vendor,
    });
  } catch (error) {
    console.error("❌ Error in createVendor2:", error);

    uploadedFiles.forEach((p) => {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (err) { }
    });

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getVendorById = async (req, res) => {
  try {
    const id = req.params.id || req.query?.id;

    if (!id) {
      return res.status(400).json({ message: "Vendor ID is required" });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        gstNumber: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        zipCode: true,
        country: true,
        currency: true,
        exchangeRate: true,
        contactPerson: true,
        contactNumber: true,
        alternateNumber: true,
        vendorAadhaar: true,
        aadhaarUrl: true,
        vendorPanCard: true,
        pancardUrl: true,
        bankName: true,
        accountHolder: true,
        accountNumber: true,
        ifscCode: true,
        isActive: true,
        referenceBy: true,
      },
    });

    if (!vendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    //const mask = (v) => (v ? v.replace(/\d(?=\d{4})/g, "*") : null);

    const responseVendor = {
      ...vendor,
      //vendorAadhaar: mask(vendor.vendorAadhaar),
      //vendorPanCard: vendor.vendorPanCard
      //  ? vendor.vendorPanCard.replace(/.(?=.{4})/g, "*")
      //  : null,
      aadhaarUrl: vendor.aadhaarUrl ? `${baseUrl}${vendor.aadhaarUrl}` : null,
      pancardUrl: vendor.pancardUrl ? `${baseUrl}${vendor.pancardUrl}` : null,
      //accountNumber: mask(vendor.accountNumber),
      //ifscCode: vendor.ifscCode
      //  ? vendor.ifscCode.replace(/.(?=.{4})/g, "*")
      //  : null,
    };

    res.status(200).json({
      success: true,
      message: `Data fetched successfully`,
      data: responseVendor,
    });
  } catch (error) {
    console.error("Error fetching vendor by ID:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const updateVendor = async (req, res) => {
  const uploadedFiles = [];
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const {
      name,
      email,
      gstNumber,
      address,
      city,
      state,
      pincode,
      zipCode,
      country,
      currency,
      exchangeRate,
      contactPerson,
      contactNumber,
      alternateNumber,
      vendorAadhaar,
      vendorPanCard,
      bankName,
      accountHolder,
      accountNumber,
      ifscCode,
      referenceBy,
    } = req.body;

    const existingVendor = await prisma.vendor.findUnique({ where: { id } });
    if (!existingVendor) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    const allowedCountries = [
      "AFGHANISTAN",
      "ALBANIA",
      "ALGERIA",
      "ANDORRA",
      "ANGOLA",
      "ANTIGUA AND BARBUDA",
      "ARGENTINA",
      "ARMENIA",
      "AUSTRALIA",
      "AUSTRIA",
      "AZERBAIJAN",
      "BAHAMAS",
      "BAHRAIN",
      "BANGLADESH",
      "BARBADOS",
      "BELARUS",
      "BELGIUM",
      "BELIZE",
      "BENIN",
      "BHUTAN",
      "BOLIVIA",
      "BOSNIA AND HERZEGOVINA",
      "BOTSWANA",
      "BRAZIL",
      "BRUNEI",
      "BULGARIA",
      "BURKINA FASO",
      "BURUNDI",
      "CAMBODIA",
      "CAMEROON",
      "CANADA",
      "CAPE VERDE",
      "CENTRAL AFRICAN REPUBLIC",
      "CHAD",
      "CHILE",
      "CHINA",
      "COLOMBIA",
      "COMOROS",
      "CONGO",
      "COSTA RICA",
      "CROATIA",
      "CUBA",
      "CYPRUS",
      "CZECH REPUBLIC",
      "DENMARK",
      "DJIBOUTI",
      "DOMINICA",
      "DOMINICAN REPUBLIC",
      "ECUADOR",
      "EGYPT",
      "EL SALVADOR",
      "ERITREA",
      "ESTONIA",
      "ESWATINI",
      "ETHIOPIA",
      "FIJI",
      "FINLAND",
      "FRANCE",
      "GABON",
      "GAMBIA",
      "GEORGIA",
      "GERMANY",
      "GHANA",
      "GREECE",
      "GRENADA",
      "GUATEMALA",
      "GUINEA",
      "GUINEA-BISSAU",
      "GUYANA",
      "HAITI",
      "HONDURAS",
      "HONG KONG",
      "HUNGARY",
      "ICELAND",
      "INDIA",
      "INDONESIA",
      "IRAN",
      "IRAQ",
      "IRELAND",
      "ISRAEL",
      "ITALY",
      "JAMAICA",
      "JAPAN",
      "JORDAN",
      "KAZAKHSTAN",
      "KENYA",
      "KUWAIT",
      "KYRGYZSTAN",
      "LAOS",
      "LATVIA",
      "LEBANON",
      "LESOTHO",
      "LIBERIA",
      "LIBYA",
      "LIECHTENSTEIN",
      "LITHUANIA",
      "LUXEMBOURG",
      "MADAGASCAR",
      "MALAWI",
      "MALAYSIA",
      "MALDIVES",
      "MALI",
      "MALTA",
      "MAURITIUS",
      "MEXICO",
      "MOLDOVA",
      "MONACO",
      "MONGOLIA",
      "MONTENEGRO",
      "MOROCCO",
      "MOZAMBIQUE",
      "MYANMAR",
      "NAMIBIA",
      "NEPAL",
      "NETHERLANDS",
      "NEW ZEALAND",
      "NICARAGUA",
      "NIGER",
      "NIGERIA",
      "NORTH KOREA",
      "NORWAY",
      "OMAN",
      "PAKISTAN",
      "PALAU",
      "PANAMA",
      "PAPUA NEW GUINEA",
      "PARAGUAY",
      "PERU",
      "PHILIPPINES",
      "POLAND",
      "PORTUGAL",
      "QATAR",
      "ROMANIA",
      "RUSSIA",
      "RWANDA",
      "SAUDI ARABIA",
      "SENEGAL",
      "SERBIA",
      "SEYCHELLES",
      "SIERRA LEONE",
      "SINGAPORE",
      "SLOVAKIA",
      "SLOVENIA",
      "SOMALIA",
      "SOUTH AFRICA",
      "SOUTH KOREA",
      "SPAIN",
      "SRI LANKA",
      "SUDAN",
      "SURINAME",
      "SWEDEN",
      "SWITZERLAND",
      "SYRIA",
      "TAIWAN",
      "TAJIKISTAN",
      "TANZANIA",
      "THAILAND",
      "TOGO",
      "TRINIDAD AND TOBAGO",
      "TUNISIA",
      "TURKEY",
      "UGANDA",
      "UKRAINE",
      "UNITED ARAB EMIRATES",
      "UNITED KINGDOM",
      "UNITED STATES",
      "URUGUAY",
      "UZBEKISTAN",
      "VATICAN CITY",
      "VENEZUELA",
      "VIETNAM",
      "YEMEN",
      "ZAMBIA",
      "ZIMBABWE",
    ];

    const allowedCurrencies = [
      "AED",
      "AFN",
      "ALL",
      "AMD",
      "AOA",
      "ARS",
      "AUD",
      "AZN",
      "BAM",
      "BBD",
      "BDT",
      "BHD",
      "BIF",
      "BMD",
      "BND",
      "BOB",
      "BRL",
      "BSD",
      "BTN",
      "BWP",
      "BYN",
      "CAD",
      "CDF",
      "CHF",
      "CLP",
      "CNY",
      "COP",
      "CRC",
      "CUP",
      "CVE",
      "CZK",
      "DJF",
      "DKK",
      "DOP",
      "DZD",
      "EGP",
      "ERN",
      "ETB",
      "EUR",
      "FJD",
      "GBP",
      "GEL",
      "GHS",
      "GMD",
      "GNF",
      "GTQ",
      "GYD",
      "HKD",
      "HNL",
      "HTG",
      "HUF",
      "IDR",
      "ILS",
      "INR",
      "IQD",
      "IRR",
      "ISK",
      "JMD",
      "JOD",
      "JPY",
      "KES",
      "KGS",
      "KHR",
      "KMF",
      "KPW",
      "KRW",
      "KWD",
      "KZT",
      "LAK",
      "LBP",
      "LKR",
      "LRD",
      "LSL",
      "LYD",
      "MAD",
      "MDL",
      "MGA",
      "MMK",
      "MNT",
      "MOP",
      "MRU",
      "MUR",
      "MVR",
      "MWK",
      "MXN",
      "MYR",
      "MZN",
      "NAD",
      "NGN",
      "NIO",
      "NOK",
      "NPR",
      "NZD",
      "OMR",
      "PAB",
      "PEN",
      "PGK",
      "PHP",
      "PKR",
      "PLN",
      "PYG",
      "QAR",
      "RON",
      "RSD",
      "RUB",
      "RWF",
      "SAR",
      "SCR",
      "SDG",
      "SEK",
      "SGD",
      "SLL",
      "SOS",
      "SRD",
      "SSP",
      "STN",
      "SYP",
      "SZL",
      "THB",
      "TJS",
      "TMT",
      "TND",
      "TOP",
      "TRY",
      "TTD",
      "TWD",
      "TZS",
      "UAH",
      "UGX",
      "USD",
      "UYU",
      "UZS",
      "VES",
      "VND",
      "VUV",
      "WST",
      "XAF",
      "XCD",
      "XOF",
      "XPF",
      "YER",
      "ZAR",
      "ZMW",
      "ZWL",
    ];

    if (country) {
      if (!allowedCountries.includes(country)) {
        uploadedFiles.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
        return res.status(400).json({
          success: false,
          message: `Invalid country. Allowed: ${allowedCountries.join(", ")}`,
        });
      }
    }

    if (currency) {
      if (!allowedCurrencies.includes(currency)) {
        uploadedFiles.forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
        return res.status(400).json({
          success: false,
          message: `Invalid currency. Allowed: ${allowedCurrencies.join(", ")}`,
        });
      }
    }

    const updateData = {
      ...(name && { name }),
      ...(email && { email }),
      ...(gstNumber && { gstNumber }),
      ...(address && { address }),
      ...(city && { city }),
      ...(state && { state }),
      ...(pincode && { pincode }),
      ...(zipCode && { zipCode }),
      ...(country && { country }),
      ...(currency && { currency }),
      ...(exchangeRate && { exchangeRate }),
      ...(contactPerson && { contactPerson }),
      ...(contactNumber && { contactNumber }),
      ...(alternateNumber && { alternateNumber }),
      ...(vendorAadhaar && { vendorAadhaar }),
      ...(vendorPanCard && { vendorPanCard }),
      ...(bankName && { bankName }),
      ...(accountHolder && { accountHolder }),
      ...(accountNumber && { accountNumber }),
      ...(ifscCode && { ifscCode }),
      ...(referenceBy && { referenceBy }),
    };

    // Keep track of what old file to remove only AFTER success
    let deleteAadhaarAfter = null;
    let deletePancardAfter = null;

    // Aadhaar file
    if (req.files?.aadhaarFile?.[0]) {
      const file = req.files.aadhaarFile[0];
      const cleanPath = file.path.replace(/\\/g, "/").split("uploads/")[1];
      updateData.aadhaarUrl = `/uploads/${cleanPath}`;
      deleteAadhaarAfter = existingVendor.aadhaarUrl;
    }

    // Pancard file
    if (req.files?.pancardFile?.[0]) {
      const file = req.files.pancardFile[0];
      const cleanPath = file.path.replace(/\\/g, "/").split("uploads/")[1];
      updateData.pancardUrl = `/uploads/${cleanPath}`;
      deletePancardAfter = existingVendor.pancardUrl;
    }

    // Detect changed fields
    const changedOldValues = {};
    const changedNewValues = {};

    for (const key in updateData) {
      if (existingVendor[key] !== updateData[key]) {
        changedOldValues[key] = existingVendor[key];
        changedNewValues[key] = updateData[key];
      }
    }

    if (Object.keys(changedNewValues).length === 0) {
      return res.status(400).json({ message: "No fields were changed." });
    }

    // RUN TRANSACTION
    const [updatedVendor, auditLog] = await prisma.$transaction([
      prisma.vendor.update({
        where: { id },
        data: updateData,
      }),
      prisma.auditLog.create({
        data: {
          entityType: "Vendor",
          entityId: id,
          action: "Updated",
          performedBy: userId || null,
          oldValue: changedOldValues,
          newValue: changedNewValues,
        },
      }),
    ]);

    // Delete old files ONLY AFTER transaction success
    if (deleteAadhaarAfter) {
      const realPath = deleteAadhaarAfter.replace(/^\//, "");
      if (fs.existsSync(realPath)) fs.unlinkSync(realPath);
    }

    if (deletePancardAfter) {
      const realPath = deletePancardAfter.replace(/^\//, "");
      if (fs.existsSync(realPath)) fs.unlinkSync(realPath);
    }

    res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      vendor: updatedVendor,
      //auditLog,
    });
  } catch (error) {
    console.error("Error updating vendor:", error);

    // ROLLBACK FILES — DELETE NEWLY UPLOADED FILES
    if (req.files?.aadhaarFile?.[0]) {
      const file = req.files.aadhaarFile[0].path;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    if (req.files?.pancardFile?.[0]) {
      const file = req.files.pancardFile[0].path;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

//------------------ Payment Request Controllers ----------------------//

const showPendingPayments = async (req, res) => {
  try {
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        grandTotal: { not: null },
        status: { not: "Cancelled" },
      },
      orderBy: {
        poDate: "desc",
      },
      include: {
        payments: {
          select: {
            amount: true,
            paymentStatus: true,
          },
        },
        company: { select: { name: true } },
        vendor: { select: { name: true } },
        items: {
          select: {
            id: true,
            itemId: true,
            itemName: true,
            hsnCode: true,
            quantity: true,
            unit: true,
          },
        },
      },
    });

    if (!purchaseOrders || purchaseOrders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Purchase Orders found.",
      });
    }

    const data = purchaseOrders.map((po) => {
      const isINR = (po.currency || "INR").toUpperCase() === "INR";

      const subTotal = Number(isINR ? po.subTotal : po.foreignSubTotal || 0);
      const grandTotal = Number(
        isINR ? po.grandTotal : po.foreignGrandTotal || 0,
      );

      const totalPaid =
        po.payments
          ?.filter((p) => p.paymentStatus === true)
          ?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      const pendingAmount = grandTotal - totalPaid;

      return {
        poId: po.id,
        poNumber: po.poNumber,
        poDate: po.poDate,
        //currency: po.currency || "INR",
        companyName: po.companyName || po.company?.name,
        vendorName: po.vendorName || po.vendor?.name,
        currency: po.currency,
        subTotal,
        grandTotal,
        totalPaid,
        pendingAmount,
        paymentStatusFlag: pendingAmount > 0 ? "Pending" : "Completed",
        orderedItems:
          po.items?.map((i) => ({
            purchaseOrderItemId: i.id,
            itemId: i.itemId,
            itemName: i.itemName,
            hsnCode: i.hsnCode,
            quantity: Number(i.quantity),
            unit: i.unit,
          })) || [],
      };
    });

    return res.status(200).json({
      success: true,
      message: "Data fetched successfully",
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const createPaymentRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (userRole.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Team can request payment",
      });
    }

    const { poId, debitNoteId, amount, billpaymentType } = req.body;

    if (!poId || !amount || !billpaymentType) {
      return res.status(400).json({
        success: false,
        message: "poId, amount & billpaymentType are required",
      });
    }

    const validTypes = [
      "Advance_Payment",
      "Partial_Payment",
      "Full_Payment",
      "Full_Payment_In_Advance",
    ];
    if (!validTypes.includes(billpaymentType)) {
      return res.status(400).json({
        success: false,
        message:
          "billpaymentType must be one of: Advance_Payment, Partial_Payment, Full_Payment, Full_Payment_In_Advance",
      });
    }

    // Get PO + payments
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        payments: {
          where: {
            paymentStatus: true,
            adminApprovalStatus: true,
          },
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    // 🔥 Decide totals based on currency
    const isINR = (po.currency || "INR").toUpperCase() === "INR";
    const poGrandTotal = Number(isINR ? po.grandTotal : po.foreignGrandTotal);

    if (!poGrandTotal) {
      return res.status(400).json({
        success: false,
        message: "PO grandTotal missing based on currency type",
      });
    }

    // Approved payments sum
    const totalPaid = po.payments.reduce((sum, p) => sum + Number(p.amount), 0);

    const remainingBalance = poGrandTotal - totalPaid;

    // Over-limit check
    if (Number(amount) > remainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Requested amount exceeds remaining PO balance`,
        details: {
          currency: po.currency || "INR",
          grandTotal: poGrandTotal,
          alreadyPaid: totalPaid,
          remaining: remainingBalance,
        },
      });
    }

    // Optional Debit Note validation
    if (debitNoteId) {
      const dn = await prisma.debitNote.findUnique({
        where: { id: debitNoteId },
      });
      if (!dn || dn.purchaseOrderId !== poId) {
        return res.status(404).json({
          success: false,
          message: "Debit Note not found for this PO",
        });
      }
    }

    // Create Payment Request
    const payment = await prisma.payment.create({
      data: {
        poId,
        debitNoteId: debitNoteId || null,
        amount,
        billpaymentType,
        createdBy: userId,
        paymentRequestedBy: userId,
        paymentDate: null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Payment request successfully submitted",
      summary: {
        currency: po.currency || "INR",
        grandTotal: poGrandTotal,
        paymentRequested: Number(amount),
        alreadyPaid: totalPaid,
        remainingAfterThis: remainingBalance - Number(amount),
      },
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const createPaymentRequest2 = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (userRole.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Team can request payment",
      });
    }

    const { poId, debitNoteId, amount, billpaymentType } = req.body;

    if (!poId || !amount || !billpaymentType) {
      return res.status(400).json({
        success: false,
        message: "poId, amount & billpaymentType are required",
      });
    }

    const validTypes = [
      "Advance_Payment",
      "Partial_Payment",
      "Full_Payment",
      "Full_Payment_In_Advance",
    ];
    if (!validTypes.includes(billpaymentType)) {
      return res.status(400).json({
        success: false,
        message:
          "billpaymentType must be one of: Advance_Payment, Partial_Payment, Full_Payment, Full_Payment_In_Advance",
      });
    }

    // Get PO + payments
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        payments: {
          where: {
            paymentStatus: true,
            adminApprovalStatus: true,
          },
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    // 🔥 Decide totals based on currency
    const isINR = (po.currency || "INR").toUpperCase() === "INR";
    const poGrandTotal = Number(isINR ? po.grandTotal : po.foreignGrandTotal);

    if (!poGrandTotal) {
      return res.status(400).json({
        success: false,
        message: "PO grandTotal missing based on currency type",
      });
    }

    // Approved payments sum
    const totalPaid = po.payments.reduce((sum, p) => sum + Number(p.amount), 0);

    const remainingBalance = poGrandTotal - totalPaid;

    // Over-limit check
    if (Number(amount) > remainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Requested amount exceeds remaining PO balance`,
        details: {
          currency: po.currency || "INR",
          grandTotal: poGrandTotal,
          alreadyPaid: totalPaid,
          remaining: remainingBalance,
        },
      });
    }

    // Optional Debit Note validation
    if (debitNoteId) {
      const dn = await prisma.debitNote.findUnique({
        where: { id: debitNoteId },
      });
      if (!dn || dn.purchaseOrderId !== poId) {
        return res.status(404).json({
          success: false,
          message: "Debit Note not found for this PO",
        });
      }
    }

    // Create Payment Request
    const payment = await prisma.payment.create({
      data: {
        poId,
        debitNoteId: debitNoteId || null,
        amount,
        billpaymentType,
        createdBy: userId,
        paymentRequestedBy: userId,
        paymentDate: null,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Payment request successfully submitted",
      summary: {
        currency: po.currency || "INR",
        grandTotal: poGrandTotal,
        paymentRequested: Number(amount),
        alreadyPaid: totalPaid,
        remainingAfterThis: remainingBalance - Number(amount),
      },
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const createPaymentRequest3 = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (userRole.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Team can request payment",
      });
    }

    const { poId, debitNoteId, amount, billpaymentType } = req.body;

    if (!poId || !amount || !billpaymentType) {
      return res.status(400).json({
        success: false,
        message: "poId, amount & billpaymentType are required",
      });
    }

    const validTypes = [
      "Advance_Payment",
      "Partial_Payment",
      "Full_Payment",
      "Full_Payment_In_Advance",
    ];

    if (!validTypes.includes(billpaymentType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid billpaymentType",
      });
    }

    // ✅ Fetch minimal PO data
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      select: {
        currency: true,
        grandTotal: true,
        foreignGrandTotal: true,
        subTotal: true,
        totalGST: true,
        payments: {
          where: {
            paymentStatus: true,
            adminApprovalStatus: true,
          },
          select: { amount: true },
        },
      },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "Purchase Order not found",
      });
    }

    const isINR = (po.currency || "INR").toUpperCase() === "INR";
    const poGrandTotal = Number(isINR ? po.grandTotal : po.foreignGrandTotal);

    if (!poGrandTotal) {
      return res.status(400).json({
        success: false,
        message: "PO grandTotal missing",
      });
    }

    // ✅ Fast sum
    let totalPaid = 0;
    for (let i = 0; i < po.payments.length; i++) {
      totalPaid += Number(po.payments[i].amount);
    }

    const remainingBalance = poGrandTotal - totalPaid;

    if (Number(amount) > remainingBalance) {
      return res.status(400).json({
        success: false,
        message: `Requested amount exceeds PO balance: ${remainingBalance}`,
      });
    }

    const isMaterialLinkedPayment =
      billpaymentType === "Partial_Payment" ||
      billpaymentType === "Full_Payment";

    let totalReceivedAmount = 0;

    if (isMaterialLinkedPayment) {
      const receipts = await prisma.purchaseOrderReceipt.findMany({
        where: { purchaseOrderId: poId },
        select: {
          goodQty: true,
          purchaseOrderItem: {
            select: {
              rate: true,
              gstRate: true,
              rateInForeign: true,
            },
          },
        },
      });

      if (!receipts.length) {
        return res.status(400).json({
          success: false,
          message:
            "No items received yet. Cannot request Partial/Full payment.",
        });
      }

      let subtotal = 0;
      let hasItemGST = false;

      for (let i = 0; i < receipts.length; i++) {
        const r = receipts[i];
        const qty = Number(r.goodQty || 0);
        const item = r.purchaseOrderItem;

        if (!item) continue;

        const rate = Number(
          isINR ? item.rate || 0 : item.rateInForeign || 0
        );

        if (item.gstRate != null) {
          hasItemGST = true;
          subtotal += rate * qty * (1 + Number(item.gstRate) / 100);
        } else {
          subtotal += rate * qty;
          console.log(subtotal);
        }
      }

      totalReceivedAmount = subtotal;
      console.log(totalReceivedAmount);

      if (!hasItemGST && po.subTotal > 0) {
        console.log(po.totalGST);
        console.log(po.subTotal);
        console.log(subtotal / po.subTotal);
        totalReceivedAmount +=
          (po.totalGST || 0) * (subtotal / po.subTotal);
        console.log(totalReceivedAmount);
      }

      const requestedTotal = totalPaid + Number(amount);

      if (requestedTotal > totalReceivedAmount) {
        return res.status(400).json({
          success: false,
          message: `You can only request up to ${(
            totalReceivedAmount - totalPaid
          ).toFixed(2)}`,
        });
      }
    }

    // ✅ Parallel DB calls (small optimization)
    let debitNoteCheck = null;

    if (debitNoteId) {
      debitNoteCheck = prisma.debitNote.findUnique({
        where: { id: debitNoteId },
        select: { purchaseOrderId: true },
      });
    }

    const dn = debitNoteCheck ? await debitNoteCheck : null;

    if (debitNoteId && (!dn || dn.purchaseOrderId !== poId)) {
      return res.status(404).json({
        success: false,
        message: "Debit Note not valid for this PO",
      });
    }

    // ✅ Create payment
    const payment = await prisma.payment.create({
      data: {
        poId,
        debitNoteId: debitNoteId || null,
        amount,
        billpaymentType,
        createdBy: userId,
        paymentRequestedBy: userId,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Payment request created successfully",
      summary: {
        grandTotal: poGrandTotal,
        totalReceivedAmount: totalReceivedAmount || null,
        alreadyPaid: totalPaid,
        requestedAmount: Number(amount),
        remainingAfterThis: remainingBalance - Number(amount),
      },
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// const createPaymentRequest3 = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     const userRole = req.user?.role;

//     if (userRole.name !== "Purchase") {
//       return res.status(403).json({
//         success: false,
//         message: "Only Purchase Team can request payment",
//       });
//     }

//     const { poId, debitNoteId, amount, billpaymentType } = req.body;

//     if (!poId || !amount || !billpaymentType) {
//       return res.status(400).json({
//         success: false,
//         message: "poId, amount & billpaymentType are required",
//       });
//     }

//     const validTypes = [
//       "Advance_Payment",
//       "Partial_Payment",
//       "Full_Payment",
//       "Full_Payment_In_Advance",
//     ];

//     if (!validTypes.includes(billpaymentType)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid billpaymentType",
//       });
//     }

//     // ✅ Fetch PO with approved payments
//     const po = await prisma.purchaseOrder.findUnique({
//       where: { id: poId },
//       include: {
//         payments: {
//           where: {
//             paymentStatus: true,
//             adminApprovalStatus: true,
//           },
//         },
//       },
//     });

//     if (!po) {
//       return res.status(404).json({
//         success: false,
//         message: "Purchase Order not found",
//       });
//     }

//     // ✅ Currency handling
//     const isINR = (po.currency || "INR").toUpperCase() === "INR";
//     const poGrandTotal = Number(isINR ? po.grandTotal : po.foreignGrandTotal);

//     if (!poGrandTotal) {
//       return res.status(400).json({
//         success: false,
//         message: "PO grandTotal missing",
//       });
//     }

//     // ✅ Already paid
//     const totalPaid = po.payments.reduce((sum, p) => sum + Number(p.amount), 0);

//     const remainingBalance = poGrandTotal - totalPaid;

//     // ❌ PO limit check
//     if (Number(amount) > remainingBalance) {
//       return res.status(400).json({
//         success: false,
//         message: `Requested amount exceeds PO balance: ${remainingBalance}`,
//         details: {
//           grandTotal: poGrandTotal,
//           alreadyPaid: totalPaid,
//           remaining: remainingBalance,
//         },
//       });
//     }

//     // 🔥 Check if receipt-based validation is required
//     const isMaterialLinkedPayment = [
//       "Partial_Payment",
//       "Full_Payment",
//     ].includes(billpaymentType);

//     let totalReceivedAmount = 0;

//     if (isMaterialLinkedPayment) {
//       const receipts = await prisma.purchaseOrderReceipt.findMany({
//         where: {
//           purchaseOrderId: poId,
//         },
//         include: {
//           purchaseOrderItem: {
//             select: {
//               rate: true,
//               gstRate: true,
//               rateInForeign: true,
//             },
//           },
//         },
//       });

//       // ❌ No receipt
//       if (!receipts.length) {
//         return res.status(400).json({
//           success: false,
//           message:
//             "No items received yet. Cannot request Partial/Full payment.",
//         });
//       }

//       // ✅ Calculate received amount
//       // totalReceivedAmount = receipts.reduce((sum, r) => {
//       //   const qty = Number(r.receivedQty || 0);

//       //   const rate = Number(
//       //     isINR
//       //       ? r.purchaseOrderItem?.rate || 0
//       //       : r.purchaseOrderItem?.rateInForeign || 0
//       //   );

//       //   return sum + qty * rate;
//       // }, 0);

//       let subtotal = 0;
//       let hasItemGST = false;

//       // 🔹 Step 1: Calculate subtotal
//       subtotal = receipts.reduce((sum, r) => {
//         const qty = Number(r.goodQty || 0);
//         const item = r.purchaseOrderItem;

//         const rate = Number(isINR ? item?.rate || 0 : item?.rateInForeign || 0);

//         const itemGst = item?.gstRate;

//         // ✅ If item GST exists → use it
//         if (itemGst !== null && itemGst !== undefined) {
//           hasItemGST = true;

//           const gstRate = Number(itemGst);
//           const amountWithGST = rate * qty * (1 + gstRate / 100);

//           return sum + amountWithGST;
//         }

//         // ❌ No GST → only base
//         return sum + rate * qty;
//       }, 0);

//       // 🔹 Step 2: Apply PO GST if needed
//       totalReceivedAmount = subtotal;

//       if (!hasItemGST) {
//         const poSubTotal = Number(po.subTotal || 0);
//         const poTotalGST = Number(po.totalGST || 0);

//         if (poSubTotal > 0) {
//           const ratio = subtotal / poSubTotal;

//           // ✅ Add proportional GST
//           totalReceivedAmount += poTotalGST * ratio;
//         }
//       }
//       console.log(totalReceivedAmount);

//       // ❌ Receipt-based limit check
//       const requestedTotal = totalPaid + Number(amount);

//       if (requestedTotal > totalReceivedAmount) {
//         return res.status(400).json({
//           success: false,
//           message: `You can only request up to ₹${(
//             totalReceivedAmount - totalPaid
//           ).toFixed(2)} based on received materials`,
//           details: {
//             totalReceivedAmount,
//             alreadyPaid: totalPaid,
//             requestedAmount: Number(amount),
//             allowedRemaining: totalReceivedAmount - totalPaid,
//           },
//         });
//       }
//     }

//     // ✅ Debit Note validation
//     if (debitNoteId) {
//       const dn = await prisma.debitNote.findUnique({
//         where: { id: debitNoteId },
//       });

//       if (!dn || dn.purchaseOrderId !== poId) {
//         return res.status(404).json({
//           success: false,
//           message: "Debit Note not valid for this PO",
//         });
//       }
//     }

//     // ✅ Create Payment
//     const payment = await prisma.payment.create({
//       data: {
//         poId,
//         debitNoteId: debitNoteId || null,
//         amount,
//         billpaymentType,
//         createdBy: userId,
//         paymentRequestedBy: userId,
//         paymentDate: null,
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Payment request created successfully",
//       summary: {
//         grandTotal: poGrandTotal,
//         totalReceivedAmount: totalReceivedAmount || null,
//         alreadyPaid: totalPaid,
//         requestedAmount: Number(amount),
//         remainingAfterThis: remainingBalance - Number(amount),
//       },
//     });
//   } catch (error) {
//     console.error("CREATE PAYMENT ERROR:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//       error: error.message,
//     });
//   }
// };


// const createPaymentRequest3 = async (req, res) => {
//   try {
//     const userId = req.user?.id;
//     const userRole = req.user?.role;

//     if (userRole.name !== "Purchase") {
//       return res.status(403).json({
//         success: false,
//         message: "Only Purchase Team can request payment",
//       });
//     }

//     const { poId, debitNoteId, amount, billpaymentType } = req.body;

//     if (!poId || !amount || !billpaymentType) {
//       return res.status(400).json({
//         success: false,
//         message: "poId, amount & billpaymentType are required",
//       });
//     }

//     const validTypes = [
//       "Advance_Payment",
//       "Partial_Payment",
//       "Full_Payment",
//       "Full_Payment_In_Advance",
//     ];

//     if (!validTypes.includes(billpaymentType)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid billpaymentType",
//       });
//     }

//     // ✅ Fetch PO
//     const po = await prisma.purchaseOrder.findUnique({
//       where: { id: poId },
//       select: {
//         currency: true,
//         grandTotal: true,
//         foreignGrandTotal: true,
//         subTotal: true,
//         totalGST: true,
//         payments: {
//           where: {
//             paymentStatus: true,
//             adminApprovalStatus: true,
//           },
//           select: { amount: true },
//         },
//       },
//     });

//     if (!po) {
//       return res.status(404).json({
//         success: false,
//         message: "Purchase Order not found",
//       });
//     }

//     const isINR = (po.currency || "INR").toUpperCase() === "INR";
//     const poGrandTotal = Number(isINR ? po.grandTotal : po.foreignGrandTotal);

//     if (!poGrandTotal) {
//       return res.status(400).json({
//         success: false,
//         message: "PO grandTotal missing",
//       });
//     }

//     // ✅ Paid sum
//     let totalPaid = 0;
//     for (let i = 0; i < po.payments.length; i++) {
//       totalPaid += Number(po.payments[i].amount);
//     }

//     const remainingBalance = poGrandTotal - totalPaid;

//     if (Number(amount) > remainingBalance) {
//       return res.status(400).json({
//         success: false,
//         message: `Requested amount exceeds PO balance: ${remainingBalance}`,
//       });
//     }

//     const isMaterialLinkedPayment =
//       billpaymentType === "Partial_Payment" ||
//       billpaymentType === "Full_Payment";

//     let totalReceivedAmount = 0;

//     // 🚀 🔥 SQL AGGREGATION STARTS HERE
//     if (isMaterialLinkedPayment) {
//       const result = await prisma.$queryRaw`
//         SELECT 
//           SUM(
//             CASE 
//               WHEN poi.gstRate IS NOT NULL 
//               THEN (por.goodQty * 
//                    (CASE 
//                       WHEN ${isINR ? 1 : 0} = 1 THEN poi.rate 
//                       ELSE poi.rateInForeign 
//                     END)
//                    * (1 + poi.gstRate / 100)
//               )
//               ELSE (por.goodQty * 
//                    (CASE 
//                       WHEN ${isINR ? 1 : 0} = 1 THEN poi.rate 
//                       ELSE poi.rateInForeign 
//                     END)
//               )
//             END
//           ) AS subtotal,

//           MAX(CASE WHEN poi.gstRate IS NOT NULL THEN 1 ELSE 0 END) AS hasItemGST

//         FROM PurchaseOrderReceipt por
//         JOIN PurchaseOrderItem poi 
//           ON por.purchaseOrderItemId = poi.id

//         WHERE por.purchaseOrderId = ${poId};
//       `;

//       const subtotal = Number(result[0]?.subtotal || 0);
//       const hasItemGST = Boolean(result[0]?.hasItemGST);

//       // ❌ No receipt
//       if (subtotal === 0) {
//         return res.status(400).json({
//           success: false,
//           message:
//             "No items received yet. Cannot request Partial/Full payment.",
//         });
//       }

//       totalReceivedAmount = subtotal;

//       // ✅ Apply PO GST if no item GST
//       if (!hasItemGST && po.subTotal > 0) {
//         totalReceivedAmount +=
//           (po.totalGST || 0) * (subtotal / po.subTotal);
//       }

//       const requestedTotal = totalPaid + Number(amount);

//       if (requestedTotal > totalReceivedAmount) {
//         return res.status(400).json({
//           success: false,
//           message: `You can only request up to ₹${(
//             totalReceivedAmount - totalPaid
//           ).toFixed(2)}`,
//         });
//       }
//     }
//     // 🚀 🔥 SQL AGGREGATION ENDS HERE

//     // ✅ Debit note check
//     let dn = null;
//     if (debitNoteId) {
//       dn = await prisma.debitNote.findUnique({
//         where: { id: debitNoteId },
//         select: { purchaseOrderId: true },
//       });

//       if (!dn || dn.purchaseOrderId !== poId) {
//         return res.status(404).json({
//           success: false,
//           message: "Debit Note not valid for this PO",
//         });
//       }
//     }

//     // ✅ Create payment
//     const payment = await prisma.payment.create({
//       data: {
//         poId,
//         debitNoteId: debitNoteId || null,
//         amount,
//         billpaymentType,
//         createdBy: userId,
//         paymentRequestedBy: userId,
//       },
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Payment request created successfully",
//       summary: {
//         grandTotal: poGrandTotal,
//         totalReceivedAmount: totalReceivedAmount || null,
//         alreadyPaid: totalPaid,
//         requestedAmount: Number(amount),
//         remainingAfterThis: remainingBalance - Number(amount),
//       },
//     });
//   } catch (error) {
//     console.error("CREATE PAYMENT ERROR:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//       error: error.message,
//     });
//   }
// };

const showAllPaymentRequests = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!["Purchase", "Admin"].includes(userRole.name)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    let whereCondition = {
      OR: [{ paymentRejected: false }, { paymentRejected: null }],
    };

    if (userRole?.name === "Purchase") {
      whereCondition.paymentRequestedBy = req.user?.id;
    }

    const requests = await prisma.payment.findMany({
      where: whereCondition,
      select: {
        id: true,
        poId: true,
        paymentRequestedBy: true,
        docApprovedBy: true,
        approvedByAdmin: true,
        paymentTransferredBy: true,
        docApprovalStatus: true,
        docApprovalDate: true,
        docApprovalRemark: true,
        adminApprovalStatus: true,
        adminApprovalDate: true,
        adminRemark: true,
        paymentStatus: true,
        paymentRemark: true,
        paymentDate: true,
        amount: true,
        createdAt: true,

        purchaseOrder: {
          select: {
            poNumber: true,
            companyName: true,
            vendorName: true,
            currency: true,
          },
        },

        payment_RequestedBy: { select: { name: true, email: true } },
        doc_ApprovedBy: { select: { name: true, email: true } },
        approvedBy_Admin: { select: { name: true, email: true } },
        payment_TransferredBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = requests.map((r) => {
      return {
        paymentRequestId: r.id,
        poId: r.poId,
        poNumber: r.purchaseOrder?.poNumber || null,
        companyName: companyShortName(r.purchaseOrder?.companyName) || null,
        vendorName: r.purchaseOrder?.vendorName || null,
        currency: r.purchaseOrder?.currency || null,
        requestedAmount: Number(r.amount),

        requestedBy: r.payment_RequestedBy?.name || null,

        docsVerification: {
          approvedBy: r.doc_ApprovedBy?.name || null,
          status: r.docApprovalStatus,
          approvedDate: r.docApprovalDate,
          remarks: r.docApprovalRemark,
        },

        adminVerification: {
          approvedBy: r.approvedBy_Admin?.name || null,
          status: r.adminApprovalStatus,
          approvedDate: r.adminApprovalDate,
          remarks: r.adminRemark,
        },

        accountsVerification: {
          approvedBy: r.payment_TransferredBy?.name || null,
          status: r.paymentStatus,
          approvedDate: r.paymentDate,
          remarks: r.paymentRemark,
        },

        createdAt: r.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      message: "All payment requests fetched successfully",
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    console.error("SHOW PAYMENT REQUESTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const rejectPaymentRequest = async (req, res) => {
  try {
    const { id } = req.query;
    const empId = req.user?.id;

    if (!empId) {
      return res.status(400).json({
        success: false,
        message: "Invalid authorization",
      });
    }

    const userRole = req.user?.role;
    if (!["Purchase"].includes(userRole.name)) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Request Id is required",
      });
    }

    const payment = await prisma.payment.findUnique({
      where: { id: id },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment request not found.",
      });
    }

    if (payment.paymentRejected) {
      return res.status(400).json({
        success: false,
        message: "Payment request already rejected",
      });
    }

    if (payment.paymentStatus || payment.paymentTransferredBy) {
      return res.status(400).json({
        success: false,
        message: "Cannot reject processed payment",
      });
    }

    await prisma.payment.update({
      where: { id: id },
      data: {
        paymentRejected: true,
        paymentRejectedBy: empId,
        paymentRejectedAt: new Date(),
        updatedBy: empId,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Payment request rejected successfully",
    });
  } catch (error) {
    console.error("ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const sendPOToVendor = async (req, res) => {
  try {
    const { poId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can send PO",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { company: true, vendor: true, items: true },
    });

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "PO not found",
      });
    }

    if (!po.vendor?.email) {
      return res.status(400).json({
        success: false,
        message: "Vendor email not found",
      });
    }

    const companyName = (po?.company?.name || "").toLowerCase();

    const { pdfBuffer, fileName } = await buildPOPdfBuffer({ po, userId });

    await sendPOMail({
      companyName: companyName,
      to: po?.vendor?.email,
      subject: `Purchase Order - ${po.poNumber}`,
      senderName: user?.name,
      replyTo: companyName.includes("galo")
        ? process.env.GALO_PO_SMTP_USER
        : process.env.GAUTAM_PO_SMTP_USER,
      html: `
        <p>Dear Sir,</p>
        <p>Please find attached Purchase Order <b>${po.poNumber}</b>.</p>

        <p>Regards,<br/>
        ${user.name}<br/>
        ${po.company.name}<br/>
        Contact: ${po.company.contactNumber}
        </p>
      `,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    return res.json({
      success: true,
      message: "PO sent to vendor successfully",
    });
  } catch (err) {
    console.error("❌ Error sending PO:", err.stack || err);
    return res.status(500).json({
      success: false,
      message: "Server error while sending PO",
    });
  }
};

const getPOsReceivings = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const validRoles = ["Purchase", "Production", "Admin"];

    if (!validRoles.includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message:
          "Only Purchase, Production & Admin department can view items receiving",
      });
    }
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        status: {
          not: "Cancelled",
        },
      },
      include: {
        items: true,
        company: true,
        vendor: true,
      },
      orderBy: {
        poDate: "desc",
      },
    });


    const formattedPOs = pos.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      companyId: po.companyId,
      companyName: po.company?.name,
      vendorId: po.vendorId,
      vendorName: po.vendor?.name,
      warehouseId: po.warehouseId,
      warehouseName: po.warehouseName,
      poDate: po.poDate,
      expectedDeliveryDate: po.expectedDeliveryDate,
      status: po.status,
      approvalStatus: po.approvalStatus,
      date:po.updatedAt,
      // ✅ ALL items (no filtering)
      items: po.items.map((item) => ({
        id: item.id,
        itemId: item.itemId,
        itemSource: item.itemSource,
        itemName: item.itemName,
        hsnCode: item.hsnCode,
        modelNumber: item.modelNumber,
        unit: item.unit,
        quantity: Number(item.quantity || 0),
        receivedQty: Number(item.receivedQty || 0),
        pendingQty: Number(item.quantity || 0) - Number(item.receivedQty || 0),
      })),
    }));

    return res.json({
      success: true,
      message: "PO list fetched for Purchase",
      data: formattedPOs,
    });
  } catch (err) {
    console.error("❌ Purchase PO Fetch Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const createUnit = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const unitName = name.trim(); // Trim only once

    // Check if item already exists
    const existingUnit = await prisma.unit.findUnique({
      where: { name: unitName },
    });

    if (existingUnit) {
      return res.status(400).json({
        success: false,
        message: "Unit Already Exists",
      });
    }

    const addUnit = await prisma.unit.create({
      data: {
        name: name,
      },
    });

    res.status(200).json({
      success: true,
      message: `Unit Added Successfully`,
      data: addUnit,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const uploadVendorInvoice = async (req, res) => {
  let uploadedFiles = [];
  try {
    const { vendorId, poId, invoiceNumber } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    const validRoles = ["Purchase"];

    if (!validRoles.includes(user.role?.name)) {
      return res.status(403).json({
        success: false,
        message: "Only Purchase department can only upload invoices",
      });
    }

    if (!vendorId) {
      return res
        .status(400)
        .json({ success: false, message: "vendorId is required" });
    }

    if (!poId) {
      return res
        .status(400)
        .json({ success: false, message: "poId is required" });
    }

    if (!invoiceNumber) {
      return res
        .status(400)
        .json({ success: false, message: "invoiceNumber is required" });
    }

    const existingVendor = await prisma.vendor.findUnique({
      where: {
        id: vendorId,
      },
    });

    if (!existingVendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    const existingPO = await prisma.purchaseOrder.findUnique({
      where: {
        id: poId,
      },
    });

    if (!existingPO) {
      return res.status(404).json({
        success: false,
        message: "PO not found",
      });
    }

    const existingVendorInvoice = await prisma.vendorInvoices.findUnique({
      where: {
        vendorId_poId_invoiceNumber: {
          vendorId,
          poId,
          invoiceNumber,
        },
      },
    });

    if (existingVendorInvoice) {
      return res.status(400).json({
        success: false,
        message: `Invoice ${invoiceNumber} already exists`,
      });
    }

    let invoiceUrl = null;

    if (req.files?.invoiceFile?.[0]) {
      const file = req.files?.invoiceFile?.[0];
      uploadedFiles.push(file.path);

      const cleanPath = file.path.replace(/\\/g, "/").split("uploads/")[1];
      invoiceUrl = `/uploads/${cleanPath}`;
    }

    const invoice = await prisma.$transaction(async (tx) => {
      const vendorInvoice = await tx.vendorInvoices.create({
        data: {
          vendorId: vendorId,
          poId: poId,
          invoiceNumber,
          invoiceUrl: invoiceUrl || null,
          createdBy: userId,
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "VendorInvoices",
          entityId: vendorInvoice.id,
          action: "Created",
          performedBy: userId,
          oldValue: null,
          newValue: vendorInvoice,
        },
      });

      return vendorInvoice;
    });

    return res.status(200).json({
      success: true,
      message: `Invoice ${invoiceNumber} uploaded for ${existingVendor.name}`,
    });
  } catch (error) {
    console.error("❌ Error in uploadVendorInvoice:", error);

    uploadedFiles.forEach((p) => {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (err) { }
    });

    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const getVendorPOInvoices = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { vendorId, fromDate, toDate } = req.query;

    const where = {};

    if (vendorId) where.vendorId = vendorId;

    if (fromDate || toDate) {
      where.poDate = {};
      if (fromDate) where.poDate.gte = new Date(fromDate);
      if (toDate) where.poDate.lte = new Date(toDate);
    }

    const pos = await prisma.purchaseOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { poDate: "desc" },
      include: {
        invoices: {
          select: {
            invoiceUrl: true,
            invoiceNumber: true,
          },
        },
      },
    });

    // Transform response
    const data = pos.map((po) => ({
      poId: po.id,
      poNumber: po.poNumber,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      //grandTotal: po.currency === "INR" ? po.grandTotal : po.foreignGrandTotal,
      invoices: po.invoices,
    }));

    // Total Count
    const total = await prisma.purchaseOrder.count({ where });

    res.json({
      success: true,
      page,
      limit,
      totalRecords: total,
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

const sendPOForApproval = async (req, res) => {
  try {
    const { poId } = req.params;
    const userRole = req.user?.role;

    if (userRole.name !== "Purchase") {
      return res.status(400).json({
        success: false,
        message: "You are not authorized to perform this action.",
      });
    }

    if (!poId) {
      return res.status(400).json({
        success: false,
        message: "Validation failed: purchase order data is required",
      });
    }

    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });

    if (!po) {
      return res.status(404).json({ success: false, message: "PO not found" });
    }

    if (po.status !== "Draft") {
      return res.status(400).json({
        success: false,
        message: "Only Draft PO can be sent for approval",
      });
    }

    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: "Approval_Sent",
        approvalStatus: "Pending",
      },
    });

    return res
      .status(200)
      .json({ success: true, message: "PO sent for approval" });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Internal Server Error",
    });
  }
};

const addBOMModel = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Model name is required",
      });
    }
    const capsModelName = name.toUpperCase().trim();
    const existingModel = await BOM.findOne({
      name: capsModelName,
    });

    if (existingModel) {
      return res.status(400).json({
        success: false,
        message: "Model already exists.",
      });
    }

    const newModel = await BOM.create({
      name: capsModelName,
      description: description || "",
      createdBy: userId,
    });

    return res.status(201).json({
      success: true,
      message: "Model created successfully",
      data: newModel,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

const downloadVendorTemplate = async (req, res) => {
  try {
    const headers = [
      "name",
      "email",
      "gstNumber",
      "address",
      "city",
      "state",
      "pincode",
      "zipCode",
      "country (e.g. INDIA)",
      "currency (e.g. INR)",
      "exchangeRate (e.g. 1 -> INDIA)",
      "contactPerson",
      "contactNumber",
      "vendorAadhaar",
      "vendorPanCard",
      "bankName",
      "accountHolder",
      "accountNumber",
      "ifscCode",
    ];

    const worksheet = xlsx.utils.json_to_sheet([], { header: headers });
    const workbook = xlsx.utils.book_new();

    xlsx.utils.book_append_sheet(workbook, worksheet, "Vendor");

    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Vendor_Template.xlsx",
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    return res.send(buffer);
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Template generation failed" });
  }
};

const importVendors = async (req, res) => {
  try {
    if (!req.file)
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length)
      return res
        .status(400)
        .json({ success: false, message: "Excel file is empty" });

    // Fetch existing GST once
    const existing = await prisma.vendor.findMany({
      where: { gstNumber: { not: null } },
      select: { gstNumber: true },
    });

    const existingGST = new Set(existing.map((v) => v.gstNumber));
    const fileGST = new Set();

    const validVendors = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const excelRow = i + 2;

      // 1️⃣ Mandatory name
      if (
        !row.name ||
        !row.state ||
        !row.address ||
        !row.city ||
        !row.contactPerson ||
        !row.contactNumber
      ) {
        errors.push({
          row: excelRow,
          reason:
            "Vendor name, address, city, state, contactPerson, contactNumber missing",
        });
        continue;
      }

      // 2️⃣ GST duplicate in DB
      if (row.gstNumber && existingGST.has(row.gstNumber)) {
        errors.push({ row: excelRow, reason: "GST already exists in system" });
        continue;
      }

      // 3️⃣ GST duplicate in same file
      if (row.gstNumber && fileGST.has(row.gstNumber)) {
        errors.push({ row: excelRow, reason: "Duplicate GST inside file" });
        continue;
      }

      fileGST.add(row.gstNumber);

      validVendors.push({
        name: row.name,
        email: row.email || null,
        gstNumber: row.gstNumber || null,
        address: row.address || null,
        city: row.city || null,
        state: row.state || null,
        pincode: row.pincode || null,
        zipCode: row.zipCode || null,
        country: row.country || "INDIA",
        currency: row.currency || "INR",
        exchangeRate: row.exchangeRate ? Number(row.exchangeRate) : 1,
        contactPerson: row.contactPerson || null,
        contactNumber: row.contactNumber || null,
        vendorAadhaar: row.vendorAadhaar || null,
        vendorPanCard: row.vendorPanCard || null,
        bankName: row.bankName || null,
        accountHolder: row.accountHolder || null,
        accountNumber: row.accountNumber || null,
        ifscCode: row.ifscCode || null,
        referenceBy: row.referenceBy || "Mr. Sohan Singh",
        createdBy: req.user?.id,
      });
    }

    let inserted = 0;

    if (validVendors.length) {
      const result = await prisma.vendor.createMany({
        data: validVendors,
      });
      inserted = result.count;
    }

    return res.status(200).json({
      success: true,
      message: `${inserted} Vendors imported successfully`,
      totalRows: rows.length,
      inserted,
      failed: errors.length,
      errors,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};
// Version 2 API

const getItemsList2 = async (req, res) => {
  try {
    /* =====================================================
       🔴 RAW MATERIAL (Prisma)
    ====================================================== */
    const rawMaterials = await prisma.rawMaterial.findMany({
      select: { id: true, name: true },
    });

    const formattedRaw = rawMaterials.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: "RAW",
      source: "mysql",
    }));

    /* =====================================================
       🔵 INFRA MATERIAL (Prisma)
    ====================================================== */
    const infraMaterials = await prisma.infraMaterial.findMany({
      select: { id: true, name: true },
    });

    const formattedInfra = infraMaterials.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: "INFRA",
      source: "mysql",
    }));

    /* =====================================================
       🟡 TOOLS & EQUIPMENTS (Prisma)
    ====================================================== */
    const tools = await prisma.toolsEquipments.findMany({
      select: { id: true, name: true },
    });

    const formattedTools = tools.map((item) => ({
      id: item.id,
      name: item.name,
      itemType: "TOOL",
      source: "mysql",
    }));

    /* =====================================================
       🟢 INSTALLATION (Mongo)
    ====================================================== */
    const mongoItems = await SystemItem.find({}, { itemName: 1 }).lean();

    const formattedMongo = mongoItems.map((item) => ({
      id: item._id.toString(),
      name: item.itemName,
      itemType: "INSTALLATION",
      source: "mongo",
    }));

    /* =====================================================
       🔁 MERGE ALL
    ====================================================== */
    const allItems = [
      ...formattedRaw,
      ...formattedInfra,
      ...formattedTools,
      ...formattedMongo,
    ];

    /* =====================================================
       🔤 SORT BY NAME (CASE-INSENSITIVE)
    ====================================================== */
    allItems.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        sensitivity: "base",
      }),
    );

    return res.status(200).json({
      success: true,
      message: "Items fetched successfully",
      count: allItems.length,
      items: allItems,
    });
  } catch (error) {
    console.error("Get Items List Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch items",
    });
  }
};

const getItemDetails2 = async (req, res) => {
  try {
    const { id } = req.params;

    /* =====================================================
       🔴 RAW MATERIAL (Prisma)
    ====================================================== */
    const rawMaterial = await prisma.rawMaterial.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        unit: true,
        hsnCode: true,
        description: true,
        conversionUnit: true,
        conversionFactor: true,
      },
    });

    if (rawMaterial) {
      return res.status(200).json({
        success: true,
        itemType: "RAW",
        source: "mysql",
        item: rawMaterial,
      });
    }

    /* =====================================================
       🔵 INFRA MATERIAL (Prisma)
    ====================================================== */
    const infraMaterial = await prisma.infraMaterial.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        unit: true,
        hsnCode: true,
        description: true,
        conversionUnit: true,
        conversionFactor: true,
      },
    });

    if (infraMaterial) {
      return res.status(200).json({
        success: true,
        itemType: "INFRA",
        source: "mysql",
        item: infraMaterial,
      });
    }

    /* =====================================================
       🟡 TOOLS & EQUIPMENTS (Prisma)
    ====================================================== */
    const tool = await prisma.toolsEquipments.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        unit: true,
        hsnCode: true,
        description: true,
        conversionUnit: true,
        conversionFactor: true,
      },
    });

    if (tool) {
      return res.status(200).json({
        success: true,
        itemType: "TOOL",
        source: "mysql",
        item: tool,
      });
    }

    /* =====================================================
       🟢 INSTALLATION (Mongo)
    ====================================================== */
    const mongoItem = await SystemItem.findById(id, {
      itemName: 1,
      unit: 1,
      hsnCode: 1,
      description: 1,
      converionUnit: 1,
      conversionFactor: 1,
    }).lean();

    if (mongoItem) {
      return res.status(200).json({
        success: true,
        itemType: "INSTALLATION",
        source: "mongo",
        item: {
          id: mongoItem._id.toString(),
          name: mongoItem.itemName,
          unit: mongoItem.unit || "",
          hsnCode: mongoItem.hsnCode || "",
          description: mongoItem.description || "",
          conversionUnit: mongoItem.converionUnit || mongoItem.unit || "",
          conversionFactor: mongoItem.conversionFactor || 1,
        },
      });
    }

    /* =====================================================
       ❌ NOT FOUND
    ====================================================== */
    return res.status(404).json({
      success: false,
      message: "Item data not found",
    });
  } catch (error) {
    console.error("Get Item Details Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch item details",
    });
  }
};

const createPurchaseOrder3 = async (req, res) => {
  try {
    const {
      heading,
      warehouseId,
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      expectedDeliveryDate,
      otherCharges = [],
      termsConditionsId,
    } = req.body;

    console.log("Req Body: ", req.body);

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can create PO",
      });
    }

    if (!warehouseId || !companyId || !vendorId || !gstType || !items?.length) {
      return res.status(400).json({
        success: false,
        message:
          "Receiving Warheouse, Company, Vendor, GST Type & Items are required",
      });
    }

    if (expectedDeliveryDate) {
      const poDateOnly = new Date();
      poDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      // if (poDateOnly.getTime() === expectedDateOnly.getTime()) {
      //   return res.status(400).json({
      //     success: false,
      //     message: "Expected Delivery Date cannot be same as PO Date",
      //   });
      // }

      if (expectedDateOnly < poDateOnly) {
        return res.status(400).json({
          success: false,
          message: "Expected Delivery Date cannot be before PO Date",
        });
      }
    }

    if (termsConditionsId) {
      const terms = await prisma.terms_Conditions.findUnique({
        where: {
          id: termsConditionsId,
        },
      });
      if (!terms) {
        return res.status(404).json({
          success: false,
          message: "Terms & Conditions Not Found",
        });
      }
    }

    let normalizedOtherCharges = [];

    // Case 1: Frontend sends single empty object → treat as empty
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const isItemWise = gstType.includes("ITEMWISE");
    console.log("Items List: ", items);
    // Validate items
    for (const item of items) {
      console.log("Item: ", item);
      if (!item.id || !item.name || !item.unit) {
        return res.status(400).json({
          success: false,
          message: "Items must include id, name, unit",
        });
      }
      if (!item.rate || !item.quantity || Number(item.quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Each item must have valid quantity & rate",
        });
      }
      if (isItemWise && (item.gstRate == null || item.gstRate === "")) {
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });
      }
      if (!isItemWise && item.gstRate) {
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
      }
    }

    const mongoIds = [];
    const mysqlIds = [];

    // Separate IDs by source
    for (const item of items) {
      if (!item.source) {
        return res.status(400).json({
          success: false,
          message: "item.source is required (mongo/mysql)",
        });
      }

      if (item.source === "mongo") {
        mongoIds.push(item.id);
      } else if (item.source === "mysql") {
        mysqlIds.push(item.id);
      } else {
        return res.status(400).json({
          success: false,
          message: `Invalid item.source '${item.source}'. Use 'mongo' or 'mysql'.`,
        });
      }
    }
    console.log("MongoIds: ", mongoIds);
    console.log("MySQLIds: ", mysqlIds);

    // Fetch all mongo items in one query
    let existingMongoItems = [];
    if (mongoIds.length) {
      existingMongoItems = await SystemItem.find({ _id: { $in: mongoIds } })
        .select("_id")
        .lean();
    }

    // Fetch all mysql items in one query
    // let existingMysqlItems = [];
    // if (mysqlIds.length) {
    //   existingMysqlItems = await prisma.rawMaterial.findMany({
    //     where: { id: { in: mysqlIds } },
    //     select: { id: true },
    //   });
    // }

    // Fetch all mysql items in one go (RAW + INFRA + TOOLS)
    let existingMysqlItems = [];

    if (mysqlIds.length) {
      const [rawItems, infraItems, toolItems] = await Promise.all([
        prisma.rawMaterial.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true },
        }),
        prisma.infraMaterial.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true },
        }),
        prisma.toolsEquipments.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true },
        }),
      ]);

      existingMysqlItems = [...rawItems, ...infraItems, ...toolItems];
    }

    // Convert to fast lookup sets
    const mongoSet = new Set(existingMongoItems.map((m) => String(m._id)));
    console.log("MongoSet: ", mongoSet);
    const mysqlSet = new Set(existingMysqlItems.map((m) => m.id));
    console.log("MySQLSet: ", mysqlSet);

    // Validate each item
    for (const item of items) {
      if (item.source === "mongo" && !mongoSet.has(item.id)) {
        console.log(`MongoId not found`);
        throw new Error(`Material with id '${item.id}' Not Found`);
      }

      if (item.source === "mysql" && !mysqlSet.has(item.id)) {
        console.log("MySqlId Not Found");
        throw new Error(`Material with id '${item.id}' Not Found`);
      }
    }
    // Fetch company & vendor
    const [company, vendor] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);

    if (!company || !vendor) {
      return res.status(404).json({
        success: false,
        message: "Company/Vendor not found",
      });
    }

    // PO currency and exchange rate
    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      exchangeRate && Number(exchangeRate) > 0
        ? new Decimal(exchangeRate).toDecimalPlaces(4, Decimal.ROUND_DOWN)
        : new Decimal(1);

    const poNumber = await generatePONumber(company);
    if (await prisma.purchaseOrder.findUnique({ where: { poNumber } })) {
      return res.status(400).json({
        success: false,
        message: `PO ${poNumber} already exists`,
      });
    }

    // ------------------------------------
    // 🧮 Subtotal & GST Calculations
    // ------------------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // Process items for DB
    const processedItems = items.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,
        rateInForeign: currency !== "INR" ? rateForeign : null,
        amountInForeign: currency !== "INR" ? amountForeign : null,
        rate: new Decimal(item.rate),
        gstRate: isItemWise ? new Decimal(item.gstRate) : null,
        quantity: qty,
        total: amountINR,
        itemGSTType: isItemWise ? gstType : null,
      };
    });

    // Add otherCharges to subtotal
    let otherChargesTotal = new Decimal(0);
    if (
      Array.isArray(normalizedOtherCharges) &&
      normalizedOtherCharges.length > 0
    ) {
      for (const ch of normalizedOtherCharges) {
        if (!ch.amount || isNaN(ch.amount)) continue;
        otherChargesTotal = otherChargesTotal.plus(new Decimal(ch.amount));
      }
    }
    let inrOtherChargesTotal = 0;
    if (finalCurrency !== "INR") {
      inrOtherChargesTotal = otherChargesTotal
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    }
    subTotalINR =
      finalCurrency === "INR"
        ? subTotalINR.plus(otherChargesTotal)
        : subTotalINR.plus(inrOtherChargesTotal);

    // GST for normal items
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(poGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(poGSTPercent.div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(poGSTPercent.div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // Item-wise GST
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotal = subTotalINR.plus(totalGST);
    const grandTotalINR = roundGrandTotal(rawGrandTotal);
    foreignSubTotal = foreignSubTotal.plus(otherChargesTotal);
    const foreignGrandTotal = roundGrandTotal(foreignSubTotal);

    let warehouseName = null;
    const warehouseData = await Warehouse.findById(warehouseId);
    if (warehouseData) {
      warehouseName = warehouseData?.warehouseName;
    }
    console.log(warehouseName);
    // ------------------------------------
    // 💾 Save Purchase Order
    // ------------------------------------
    const newPO = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          heading: heading || "Purchase Order",
          poNumber,
          financialYear: getFinancialYear(),
          companyId,
          companyName: company.name,
          vendorId,
          vendorName: vendor.name,
          warehouseId,
          warehouseName,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate,
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          fixedGrandTotal: rawGrandTotal,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          termsConditionsId: termsConditionsId || null,
          createdBy: userId,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : null,
          otherCharges: normalizedOtherCharges,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "CREATED",
          performedBy: userId,
          newValue: po,
        },
      });

      return po;
    });
    console.log("Saved PO: ", newPO);
    return res.status(201).json({
      success: true,
      message: "✅ Purchase Order created successfully",
      data: newPO,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error while creating PO",
    });
  }
};

const updatePurchaseOrder3 = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      warehouseId,
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      expectedDeliveryDate,
      otherCharges = [],
    } = req.body;

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can update PO",
      });
    }

    let normalizedOtherCharges = [];
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const existingPO = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });

    if (!existingPO)
      return res.status(404).json({ success: false, message: "PO not found" });

    // if (existingPO.status !== "Draft") {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Only Draft PO can be updated",
    //   });
    // }

    if (expectedDeliveryDate) {
      const poDateOnly = new Date(existingPO.poDate);
      poDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      // if (poDateOnly.getTime() === expectedDateOnly.getTime()) {
      //   return res.status(400).json({
      //     success: false,
      //     message:
      //       "Expected Delivery Date cannot be the same as Purchase Order Date",
      //   });
      // }

      if (expectedDateOnly < poDateOnly) {
        return res.status(400).json({
          success: false,
          message:
            "Expected Delivery Date cannot be earlier than Purchase Order Date",
        });
      }
    }

    if (!items?.length)
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });

    const isItemWise = gstType.includes("ITEMWISE");

    // Validate items
    for (const item of items) {
      if (!item.id || !item.name || !item.unit)
        return res.status(400).json({
          success: false,
          message: "Each item must include id, name, and unit",
        });

      if (!item.rate || !item.quantity || Number(item.quantity) <= 0)
        return res.status(400).json({
          success: false,
          message: "Each item must have valid rate and quantity",
        });

      if (isItemWise && (item.gstRate == null || item.gstRate === ""))
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });

      if (!isItemWise && item.gstRate)
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
    }

    // ------------------------------------
    // 🔎 Validate item existence (Mongo + MySQL ALL tables)
    // ------------------------------------
    const mongoIds = [];
    const mysqlIds = [];

    for (const item of items) {
      if (!item.source) {
        return res.status(400).json({
          success: false,
          message: "item.source is required (mongo/mysql)",
        });
      }

      if (item.source === "mongo") {
        mongoIds.push(item.id);
      } else if (item.source === "mysql") {
        mysqlIds.push(item.id);
      } else {
        return res.status(400).json({
          success: false,
          message: `Invalid item.source '${item.source}'. Use 'mongo' or 'mysql'.`,
        });
      }
    }

    // Fetch Mongo items
    let existingMongoItems = [];
    if (mongoIds.length) {
      existingMongoItems = await SystemItem.find({
        _id: { $in: mongoIds },
      })
        .select("_id")
        .lean();
    }

    // Fetch MySQL items (RAW + INFRA + TOOLS)
    let existingMysqlItems = [];

    if (mysqlIds.length) {
      const [rawItems, infraItems, toolItems] = await Promise.all([
        prisma.rawMaterial.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true },
        }),
        prisma.infraMaterial.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true },
        }),
        prisma.tools_Equipments.findMany({
          where: { id: { in: mysqlIds } },
          select: { id: true },
        }),
      ]);

      existingMysqlItems = [...rawItems, ...infraItems, ...toolItems];
    }

    const mongoSet = new Set(existingMongoItems.map((m) => String(m._id)));
    const mysqlSet = new Set(existingMysqlItems.map((m) => m.id));

    // Final Validation
    for (const item of items) {
      if (item.source === "mongo" && !mongoSet.has(item.id)) {
        throw new Error(`System Item with id '${item.id}' Not Found`);
      }

      if (item.source === "mysql" && !mysqlSet.has(item.id)) {
        throw new Error(`Item with id '${item.id}' Not Found in MySQL tables`);
      }
    }

    const oldValue = JSON.parse(JSON.stringify(existingPO));

    // Fetch vendor
    const vendorToUseId = vendorId || existingPO.vendorId;
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorToUseId },
    });

    if (!vendor)
      return res
        .status(404)
        .json({ success: false, message: "Vendor not found" });

    const companyToUseId = companyId || existingPO.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyToUseId },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      finalCurrency === "INR"
        ? new Decimal(1)
        : new Decimal(exchangeRate || 1).toDecimalPlaces(4, Decimal.ROUND_DOWN);

    // -------------------------
    // Totals
    // -------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // -------------------------
    // ⭐ UNIVERSAL GST LOGIC FOR EACH ITEM ⭐
    // -------------------------
    const processedItems = items.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      let itemGSTType = null;
      let itemGSTRate = null;

      const isExempted = gstType.includes("EXEMPTED");
      const isItemWiseGST = gstType.includes("ITEMWISE");

      if (isExempted) {
        // CASE 1 — EXEMPTED
        itemGSTType = null;
        itemGSTRate = null;
      } else if (isItemWiseGST) {
        // CASE 2 — ITEMWISE
        itemGSTType = gstType;
        itemGSTRate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );
      } else {
        // CASE 3 — Normal IGST/LGST 5/12/18/28
        itemGSTRate = null;
        itemGSTType = null;
      }

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,

        rateInForeign: finalCurrency !== "INR" ? rateForeign : null,
        amountInForeign: finalCurrency !== "INR" ? amountForeign : null,

        rate: new Decimal(item.rate),
        quantity: qty,

        gstRate: itemGSTRate,
        itemGSTType: itemGSTType,

        total: amountINR,
      };
    });

    // OTHER CHARGES
    let otherChargesTotal = new Decimal(0);
    if (Array.isArray(otherCharges)) {
      for (const ch of otherCharges) {
        if (ch == null) continue;
        const amt = ch.amount ?? ch.value ?? null;
        if (amt == null || isNaN(amt)) continue;
        otherChargesTotal = otherChargesTotal
          .plus(new Decimal(amt))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }
    subTotalINR = subTotalINR.plus(otherChargesTotal);

    // GST FOR NORMAL ITEMS
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // GST FOR ITEMWISE
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotalINR = subTotalINR
      .plus(totalGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const grandTotalINR = roundGrandTotal(rawGrandTotalINR);
    const foreignGrandTotal = foreignSubTotal.toDecimalPlaces(
      4,
      Decimal.ROUND_DOWN,
    );

    const updatedPO = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: poId },
      });

      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          companyId: companyId || existingPO.companyId,
          companyName: company.name || existingPO.companyName,
          vendorId: vendorId || existingPO.vendorId,
          vendorName: vendor.name || existingPO.vendorName,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate.toString(),
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : existingPO.expectedDeliveryDate,
          otherCharges: normalizedOtherCharges,
          warehouseId: warehouseId || existingPO.warehouseId,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "UPDATED",
          performedBy: userId,
          oldValue,
          newValue: po,
        },
      });

      return po;
    });

    res.json({
      success: true,
      message: "✅ Purchase Order updated successfully",
      data: updatedPO,
    });
  } catch (err) {
    console.error("PO Update Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error while updating PO",
    });
  }
};

const updatePurchaseOrderController = async (req, res) => {
  try {
    const { poId } = req.params;
    const {
      warehouseId,
      companyId,
      vendorId,
      gstType,
      items,
      remarks,
      paymentTerms,
      deliveryTerms,
      warranty,
      contactPerson,
      cellNo,
      currency,
      exchangeRate,
      expectedDeliveryDate,
      otherCharges = [],
    } = req.body;

    const userId = req.user?.id;
    if (!userId)
      return res
        .status(400)
        .json({ success: false, message: "User not found" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user || user.role?.name !== "Purchase") {
      return res.status(403).json({
        success: false,
        message: "Only Purchase Department can update PO",
      });
    }

    if (!warehouseId || !companyId || !vendorId || !gstType || !items?.length) {
      return res.status(400).json({
        success: false,
        message:
          "Receiving Warheouse, Company, Vendor, GST Type & Items are required",
      });
    }

    let normalizedOtherCharges = [];
    if (
      Array.isArray(otherCharges) &&
      otherCharges.length === 1 &&
      otherCharges[0]?.name === "" &&
      otherCharges[0]?.amount === ""
    ) {
      normalizedOtherCharges = [];
    }
    // Case 2: Validate proper other charges
    else if (Array.isArray(otherCharges) && otherCharges.length > 0) {
      for (const ch of otherCharges) {
        if (
          !ch.name ||
          ch.name.trim() === "" ||
          ch.amount === "" ||
          ch.amount == null ||
          isNaN(ch.amount)
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid otherCharges: name and amount are required for each charge",
          });
        }

        normalizedOtherCharges.push({
          name: ch.name.trim(),
          amount: new Decimal(ch.amount),
        });
      }
    }

    const existingPO = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });

    if (!existingPO)
      return res.status(404).json({ success: false, message: "PO not found" });

    if (expectedDeliveryDate) {
      const poDateOnly = new Date(existingPO.poDate);
      poDateOnly.setHours(0, 0, 0, 0);

      const expectedDateOnly = new Date(expectedDeliveryDate);
      expectedDateOnly.setHours(0, 0, 0, 0);

      if (expectedDateOnly < poDateOnly) {
        return res.status(400).json({
          success: false,
          message:
            "Expected Delivery Date cannot be earlier than Purchase Order Date",
        });
      }
    }

    if (!items?.length)
      return res.status(400).json({
        success: false,
        message: "At least one item is required",
      });

    const isItemWise = gstType.includes("ITEMWISE");

    // Validate items
    for (const item of items) {
      if (!item.id || !item.name || !item.unit)
        return res.status(400).json({
          success: false,
          message: "Each item must include id, name, and unit",
        });

      if (!item.rate || !item.quantity || Number(item.quantity) <= 0)
        return res.status(400).json({
          success: false,
          message: "Each item must have valid rate and quantity",
        });

      if (isItemWise && (item.gstRate == null || item.gstRate === ""))
        return res.status(400).json({
          success: false,
          message: "Each item must have gstRate for item-wise GST PO",
        });

      if (!isItemWise && item.gstRate)
        return res.status(400).json({
          success: false,
          message: "gstRate is only allowed when PO GST type is ITEMWISE",
        });
    }

    // ✅ Collect all IDs
    const allIds = items.map((i) => String(i.id));

    // ✅ Only valid Mongo ObjectIds
    const mongoIds = allIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    // ✅ Remaining are MySQL UUIDs
    const mysqlIds = allIds.filter(
      (id) => !mongoose.Types.ObjectId.isValid(id),
    );

    // ✅ Fetch from Mongo
    const mongoItems = await SystemItem.find({
      _id: { $in: mongoIds },
    })
      .select("_id itemName")
      .lean();

    // ✅ Fetch from MySQL
    const mysqlItems = await prisma.rawMaterial.findMany({
      where: { id: { in: mysqlIds } },
      select: { id: true, name: true },
    });

    // ✅ Create lookup maps
    const mongoMap = new Map(
      mongoItems.map((i) => [String(i._id), i.itemName?.trim()]),
    );

    const mysqlMap = new Map(mysqlItems.map((i) => [i.id, i.name?.trim()]));

    for (const item of items) {
      const id = String(item.id);
      const name = item.name;

      if (!mongoMap.has(id) && !mysqlMap.has(id)) {
        throw new Error(`Item not found in any DB: ${name}`);
      }
    }

    // ✅ Validate + detect source
    const validatedItems = items.map((item) => {
      const id = String(item.id);
      const name = item.name?.trim();

      let detectedSource = null;

      if (mongoMap.has(id)) {
        const dbName = mongoMap.get(id);

        if (dbName !== name) {
          throw new Error(`Item name mismatch for Mongo ID ${id}`);
        }

        detectedSource = "mongo";
      } else if (mysqlMap.has(id)) {
        const dbName = mysqlMap.get(id);

        if (dbName !== name) {
          throw new Error(`Item name mismatch for MySQL ID ${id}`);
        }

        detectedSource = "mysql";
      } else {
        throw new Error(`Item not found in any DB: ${id}`);
      }

      return {
        ...item,
        source: detectedSource,
      };
    });

    console.table(
      validatedItems.map((i) => ({
        id: i.id,
        source: i.source,
        name: i.name,
      })),
    );

    const oldValue = JSON.parse(JSON.stringify(existingPO));

    // Fetch company & vendor
    const [company, vendor] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.vendor.findUnique({ where: { id: vendorId } }),
    ]);

    if (!company || !vendor) {
      return res.status(404).json({
        success: false,
        message: "Company/Vendor not found",
      });
    }

    const finalCurrency = currency || "INR";
    const finalExchangeRate =
      finalCurrency === "INR"
        ? new Decimal(1)
        : new Decimal(exchangeRate || 1).toDecimalPlaces(4, Decimal.ROUND_DOWN);

    // -------------------------
    // Totals
    // -------------------------
    let foreignSubTotal = new Decimal(0);
    let subTotalINR = new Decimal(0);
    let totalCGST = new Decimal(0);
    let totalSGST = new Decimal(0);
    let totalIGST = new Decimal(0);

    const normalItems = [];
    const itemWiseItems = [];

    // -------------------------
    // ⭐ UNIVERSAL GST LOGIC FOR EACH ITEM ⭐
    // -------------------------
    const processedItems = items.map((item) => {
      const qty = new Decimal(item.quantity).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const rateForeign = new Decimal(item.rate).toDecimalPlaces(
        4,
        Decimal.ROUND_DOWN,
      );
      const amountForeign = rateForeign
        .mul(qty)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      const amountINR = amountForeign
        .mul(finalExchangeRate)
        .toDecimalPlaces(4, Decimal.ROUND_DOWN);

      foreignSubTotal = foreignSubTotal.plus(amountForeign);
      subTotalINR = subTotalINR.plus(amountINR);

      isItemWise ? itemWiseItems.push(item) : normalItems.push(item);

      let itemGSTType = null;
      let itemGSTRate = null;

      const isExempted = gstType.includes("EXEMPTED");
      const isItemWiseGST = gstType.includes("ITEMWISE");

      if (isExempted) {
        // CASE 1 — EXEMPTED
        itemGSTType = null;
        itemGSTRate = null;
      } else if (isItemWiseGST) {
        // CASE 2 — ITEMWISE
        itemGSTType = gstType;
        itemGSTRate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );
      } else {
        // CASE 3 — Normal IGST/LGST 5/12/18/28
        itemGSTRate = null;
        itemGSTType = null;
      }

      return {
        itemId: item.id,
        itemSource: item.source,
        itemName: item.name,
        hsnCode: item.hsnCode || null,
        modelNumber: item.modelNumber || null,
        itemDetail: item.itemDetail || null,
        unit: item.unit,

        rateInForeign: finalCurrency !== "INR" ? rateForeign : null,
        amountInForeign: finalCurrency !== "INR" ? amountForeign : null,

        rate: new Decimal(item.rate),
        quantity: qty,

        gstRate: itemGSTRate,
        itemGSTType: itemGSTType,

        total: amountINR,
      };
    });

    // OTHER CHARGES
    let otherChargesTotal = new Decimal(0);
    if (Array.isArray(otherCharges)) {
      for (const ch of otherCharges) {
        if (ch == null) continue;
        const amt = ch.amount ?? ch.value ?? null;
        if (amt == null || isNaN(amt)) continue;
        otherChargesTotal = otherChargesTotal
          .plus(new Decimal(amt))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }
    subTotalINR = subTotalINR.plus(otherChargesTotal);

    // GST FOR NORMAL ITEMS
    const poGSTPercent =
      isItemWise || gstType.includes("EXEMPTED")
        ? null
        : getGSTPercent(gstType);

    if (normalItems.length && poGSTPercent) {
      const normalTotalINR = subTotalINR;

      if (gstType.startsWith("LGST")) {
        totalCGST = totalCGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        totalSGST = totalSGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(200)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      } else if (gstType.startsWith("IGST")) {
        totalIGST = totalIGST
          .plus(normalTotalINR.mul(new Decimal(poGSTPercent).div(100)))
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
      }
    }

    // GST FOR ITEMWISE
    if (isItemWise) {
      for (const item of itemWiseItems) {
        const totalINR = new Decimal(item.rate)
          .mul(item.quantity)
          .mul(finalExchangeRate)
          .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        const rate = new Decimal(item.gstRate).toDecimalPlaces(
          4,
          Decimal.ROUND_DOWN,
        );

        if (gstType === "LGST_ITEMWISE") {
          totalCGST = totalCGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
          totalSGST = totalSGST
            .plus(totalINR.mul(rate.div(200)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        } else if (gstType === "IGST_ITEMWISE") {
          totalIGST = totalIGST
            .plus(totalINR.mul(rate.div(100)))
            .toDecimalPlaces(4, Decimal.ROUND_DOWN);
        }
      }
    }

    const totalGST = totalCGST
      .plus(totalSGST)
      .plus(totalIGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const rawGrandTotalINR = subTotalINR
      .plus(totalGST)
      .toDecimalPlaces(4, Decimal.ROUND_DOWN);
    const grandTotalINR = roundGrandTotal(rawGrandTotalINR);
    const foreignGrandTotal = foreignSubTotal.toDecimalPlaces(
      4,
      Decimal.ROUND_DOWN,
    );

    const updatedPO = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.deleteMany({
        where: { purchaseOrderId: poId },
      });

      const po = await tx.purchaseOrder.update({
        where: { id: poId },
        data: {
          companyId: companyId || existingPO.companyId,
          companyName: company.name || existingPO.companyName,
          vendorId: vendorId || existingPO.vendorId,
          vendorName: vendor.name || existingPO.vendorName,
          gstType,
          gstRate: poGSTPercent,
          currency: finalCurrency,
          exchangeRate: finalExchangeRate.toString(),
          foreignSubTotal: foreignSubTotal.toDecimalPlaces(
            4,
            Decimal.ROUND_DOWN,
          ),
          foreignGrandTotal,
          subTotal: subTotalINR.toDecimalPlaces(4, Decimal.ROUND_DOWN),
          totalCGST,
          totalSGST,
          totalIGST,
          totalGST,
          grandTotal: grandTotalINR,
          remarks,
          paymentTerms,
          deliveryTerms,
          warranty,
          contactPerson,
          cellNo,
          expectedDeliveryDate: expectedDeliveryDate
            ? new Date(expectedDeliveryDate)
            : existingPO.expectedDeliveryDate,
          otherCharges: normalizedOtherCharges,
          warehouseId: warehouseId || existingPO.warehouseId,
          items: {
            create: processedItems,
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "UPDATED",
          performedBy: userId,
          oldValue,
          newValue: po,
        },
      });

      return po;
    });

    res.json({
      success: true,
      message: "✅ Purchase Order updated successfully",
      data: updatedPO,
    });
  } catch (err) {
    console.error("PO Update Error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Server error while updating PO",
    });
  }
};


module.exports = {
  createCompany,
  createVendor,
  updateCompany,
  updateVendor,
  getCompaniesList,
  getVendorsList,
  getItemsList,
  getItemDetails,
  createPurchaseOrder,
  createPurchaseOrder2,
  updatePurchaseOrder,
  updatePurchaseOrder2,
  getPOList,
  getPurchaseOrderDetails,
  downloadPOPDF,
  downloadPOPDF2,
  sendOrResendPO,
  getCompanyById,
  getVendorById,
  getPODashboard,
  getCompaniesData,
  getVendorsData,
  createWarehouse,
  getWarehouses,
  getSystems,
  cancelPurchaseOrder,
  getPurchaseOrderDetailsWithDamagedItems,
  createDebitNote,
  getDebitNoteListByPO,
  downloadDebitNote,
  getDebitNoteDetails,
  updateDebitNote,
  debitNoteReceivingBill,
  addTermCondition,
  toggleTermConditionStatus,
  getAllTerms,
  getActiveTerms,
  getSystemDashboardData,
  getRawMaterialByWarehouse,
  getPOListByCompany2,
  getPODashboard2,
  createVendor2,
  getVendorById2,
  updateVendor2,
  showPendingPayments,
  createPaymentRequest,
  showAllPaymentRequests,
  rejectPaymentRequest,
  sendPOToVendor,
  getPOsReceivings,
  createUnit,
  uploadVendorInvoice,
  getVendorPOInvoices,
  sendPOForApproval,
  addBOMModel,
  upload,
  downloadVendorTemplate,
  //version 2
  uploadTermsFromExcel,
  getItemsList2,
  getItemDetails2,
  createPurchaseOrder3,
  createPaymentRequest3,

  //new version api - 26-06-2026
  updatePurchaseOrderController
};
