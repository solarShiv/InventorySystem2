// const fs = require("fs");
// const path = require("path");
// const ejs = require("ejs");
// const Decimal = require("decimal.js");
// const puppeteer = require("puppeteer");
// const numberToWords = require("./numberToWords"); // INR words

// const CURRENCY_META = {
//   INR: { locale: "en-IN", symbol: "₹", fractionDigits: 2 },
//   USD: { locale: "en-US", symbol: "$", fractionDigits: 2 },
//   EUR: { locale: "de-DE", symbol: "€", fractionDigits: 2 },
//   GBP: { locale: "en-GB", symbol: "£", fractionDigits: 2 },
//   AED: { locale: "en-AE", symbol: "د.إ", fractionDigits: 2 },
// };

// function getCurrencyMeta(code = "INR") {
//   return (
//     CURRENCY_META[code] || { locale: "en-US", symbol: code, fractionDigits: 2 }
//   );
// }

// function amountToWords(amount, currencyCode = "INR") {
//   const rounded = Math.round(Number(amount || 0) * 100) / 100;
//   try {
//     return numberToWords(rounded, currencyCode);
//   } catch {
//     return `${rounded} ${currencyCode}`;
//   }
// }

// function getGSTLabel(po) {
//   const gstType = (po.gstType || "").toString();
//   if (gstType.includes("ITEMWISE") || gstType.includes("EXEMPTED")) return "";
//   if (gstType.startsWith("IGST_")) return `IGST @ ${gstType.split("_")[1]}%`;
//   if (gstType.startsWith("LGST_")) {
//     const rate = gstType.split("_")[1];
//     return `CGST @ ${rate / 2}% + SGST @ ${rate / 2}%`;
//   }
//   return "";
// }

// function fixNum(val, d = 4) {
//   return new Decimal(val ?? "0") // STRING OR DECIMAL
//     .toDecimalPlaces(d, Decimal.ROUND_DOWN)
//     .toNumber();
// }

// function addNum(a, b, d = 4) {
//   return new Decimal(a ?? "0")
//     .plus(new Decimal(b ?? "0"))
//     .toDecimalPlaces(d, Decimal.ROUND_DOWN)
//     .toNumber();
// }

// function formatNumberOnly(val, currencyCode, decimals) {
//   const meta = getCurrencyMeta(currencyCode);

//   const str = new Decimal(val || 0)
//     .toDecimalPlaces(decimals, Decimal.ROUND_DOWN)
//     .toFixed(decimals);

//   return Number(str).toLocaleString(meta.locale, {
//     minimumFractionDigits: decimals,
//     maximumFractionDigits: decimals,
//   });
// }

// function formatWithDecimals(val, currencyCode, decimals) {
//   const meta = getCurrencyMeta(currencyCode);

//   const str = new Decimal(val || 0)
//     .toDecimalPlaces(decimals, Decimal.ROUND_DOWN)
//     .toFixed(decimals);

//   return `${meta.symbol} ${Number(str).toLocaleString(meta.locale, {
//     minimumFractionDigits: decimals,
//     maximumFractionDigits: decimals,
//   })}`;
// }

// function roundGrandTotal(value) {
//   const amount = new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_DOWN);
//   const integerPart = amount.floor();
//   const decimalPart = amount.minus(integerPart);

//   if (decimalPart.greaterThanOrEqualTo(new Decimal(0.5))) {
//     return integerPart.plus(1).toDecimalPlaces(4, Decimal.ROUND_DOWN);
//   }

//   return integerPart.toDecimalPlaces(4, Decimal.ROUND_DOWN);
// }


// async function generatePOBuffer(po, items = []) {
//   const tplPath = path.join(__dirname, "../templates/poTemplate.ejs");
//   const tpl = fs.readFileSync(tplPath, "utf8");

//   const currencyCode = po.currency?.toString() || "INR";
//   const meta = getCurrencyMeta(currencyCode);
//   const exchangeRate = Number(po.exchangeRate || 1);

//   const gstType = (po.gstType || "").toUpperCase();
//   const isItemWise = gstType.includes("ITEMWISE");
//   const isExempted = gstType.includes("EXEMPTED");
//   const isIGST = gstType.startsWith("IGST_");
//   const isLGST = gstType.startsWith("LGST_");

//   let totalQty = 0;
//   let subtotalCurrency = 0;
//   let totalOtherChargesCurrency = 0;

//   // Prepare item rows
//   const preparedRows = (items || []).map((it, i) => {
//     const qty = fixNum(it.quantity, 4);
//     const rate = fixNum(it.rate, 4);
//     const lineAmount = fixNum(
//       po.currency === "INR" ? it.total : it.amountInForeign,
//       4
//     );

//     totalQty = addNum(totalQty, qty, 4);
//     subtotalCurrency = addNum(subtotalCurrency, lineAmount, 4);

//     let gstRate = 0;
//     let gstAmount = 0;
//     let finalAmount = lineAmount;

//     if (isItemWise) {
//       gstRate = Number(it.gstRate || 0);
//       gstAmount = fixNum(new Decimal(lineAmount).mul(gstRate).div(100), 4);

//       finalAmount = addNum(finalAmount, gstAmount, 4);
//     }
   
//     return {
//       sno: i + 1,
//       itemName: it.itemName || "",
//       modelNumber: it.modelNumber || "",
//       itemDetail: it.itemDetail ? String(it.itemDetail) : "",
//       hsn: it.hsnCode || "",
//       qty,
//       unit: it.unit || "Nos",
//       rateRaw: rate,
//       rate: formatNumberOnly(rate, currencyCode, 4),
//       lineAmountRaw: lineAmount,
//       lineAmount: formatNumberOnly(lineAmount, currencyCode, 4),
//       gstRate: isItemWise ? `${gstRate}%` : "",
//       gstAmountRaw: gstAmount,
//       gstAmount: isItemWise ? formatNumberOnly(gstAmount, currencyCode, 4) : "",
//       amountRaw: finalAmount,
//       amount: formatNumberOnly(finalAmount, currencyCode, 4),
//     };
//   });

//   // Other charges
//   const otherCharges = po.otherCharges || [];
//   for (const ch of otherCharges) {
//     const amt = ch?.amount ?? ch?.value ?? "0";
//     totalOtherChargesCurrency = addNum(totalOtherChargesCurrency, amt, 4);
//   }

//   const subTotalCurrency = subtotalCurrency;

//   let totalCGST = 0,
//     totalSGST = 0,
//     totalIGST = 0,
//     totalGST = 0,
//     grandTotalCurrency = 0;

//   if (isItemWise) {
//     totalGST = preparedRows.reduce(
//       (acc, r) => addNum(acc, r.gstAmountRaw || 0, 4),
//       0
//     );

//     const itemsTotal = preparedRows.reduce(
//       (acc, r) => addNum(acc, r.amountRaw || 0, 4),
//       0
//     );
//     grandTotalCurrency = addNum(itemsTotal, totalOtherChargesCurrency, 4);
    
//   } else if (isExempted) {
//     totalGST = 0;
//     grandTotalCurrency = fixNum(
//       subTotalCurrency + totalOtherChargesCurrency,
//       4
//     );
//   } else {
//     const taxableAmount = fixNum(
//       subTotalCurrency + totalOtherChargesCurrency,
//       4
//     );

//     const rate = Number(po.gstRate || gstType.split("_")[1] || 0);

//     if (isIGST) {
//       totalIGST = fixNum(new Decimal(taxableAmount).mul(rate).div(100), 4);
//       totalGST = totalIGST;
//       grandTotalCurrency = addNum(taxableAmount, totalGST, 4);
//     } else if (isLGST) {
//       totalCGST = fixNum((taxableAmount * rate) / 2 / 100, 4);
//       totalSGST = fixNum((taxableAmount * rate) / 2 / 100, 4);
//       totalGST = fixNum(totalCGST + totalSGST, 4);
//       grandTotalCurrency = fixNum(taxableAmount + totalGST, 4);
//     } else {
//       totalGST = 0;
//       grandTotalCurrency = taxableAmount;
//     }
//   }
//   grandTotalCurrency = roundGrandTotal(grandTotalCurrency).toNumber();
//   const gstLabel = getGSTLabel(po);
//   const grandTotalInWords = amountToWords(grandTotalCurrency, currencyCode);

//   // Paginate rows
//   const pages = (function paginateRows(preparedRowsLocal) {
//     const FULL_PAGE = 5;
//     const FOOTER_PAGE = 4;
//     let rows = [...preparedRowsLocal];
//     let pagesArr = [];
//     const pushPage = (arr, padTo = FULL_PAGE) => {
//       while (arr.length < padTo) arr.push(null);
//       pagesArr.push(arr);
//     };
//     if (rows.length < FULL_PAGE) {
//       pushPage(rows.splice(0), FOOTER_PAGE);
//       return pagesArr;
//     }
//     if (rows.length === FULL_PAGE) {
//       pushPage(rows.splice(0, FULL_PAGE - 1), FULL_PAGE);
//       pushPage(rows.splice(0, 1), FOOTER_PAGE);
//       return pagesArr;
//     }
//     if (rows.length % FULL_PAGE === 0) {
//       while (rows.length > FULL_PAGE) pushPage(rows.splice(0, FULL_PAGE));
//       pushPage(rows.splice(0, FULL_PAGE - 1));
//       pushPage(rows.splice(0, 1), FOOTER_PAGE);
//       return pagesArr;
//     }
//     while (rows.length > FULL_PAGE) pushPage(rows.splice(0, FULL_PAGE));
//     if (rows.length > 0) pushPage(rows.splice(0, rows.length), FOOTER_PAGE);
//     return pagesArr;
//   })(preparedRows);

//   // Formatted totals
//   const grandTotalFormatted = formatWithDecimals(
//     grandTotalCurrency,
//     currencyCode,
//     4
//   );
  
//   const totalOtherChargesFormatted = formatNumberOnly(
//     totalOtherChargesCurrency,
//     currencyCode,
//     4
//   );
//   const totalGSTFormatted = formatNumberOnly(totalGST, currencyCode, 4);
//   const cgstFormatted = formatNumberOnly(totalCGST, currencyCode, 4);
//   const sgstFormatted = formatNumberOnly(totalSGST, currencyCode, 4);
//   const igstFormatted = formatNumberOnly(totalIGST, currencyCode, 4);

//   const html = ejs.render(tpl, {
//     companyName: po.company?.name,
//     companySub: po.company?.subtitle,
//     companyAddress: po.company?.address,
//     companyGST: po.company?.gstNumber,
//     vendorName: po.vendor?.name,
//     vendorAddress: po.vendor?.address,
//     vendorGST: po.vendor?.gstNumber,
//     vendorEmail: po.vendor?.email,
//     vendorContactPerson: po.vendor?.contactPerson,
//     vendorPhone: po.vendor?.contactNumber,
//     poNumber: po.poNumber,
//     poDate: new Date(po.createdAt).toLocaleDateString("en-IN"),
//     paymentTerms: po.paymentTerms,
//     deliveryTerms: po.deliveryTerms,
//     contactPerson: po.contactPerson,
//     cellNo: po.cellNo,
//     warranty: po.warranty,
//     gstType,
//     gstRate: po.gstRate,
//     rows: preparedRows,
//     pages,
//     totalQty,
//     subTotalCurrency,
//     totalOtherChargesCurrency,
//     totalOtherCharges: totalOtherChargesFormatted,
//     totalGSTCurrency: totalGST,
//     totalGST: totalGSTFormatted,
//     cgst: cgstFormatted,
//     sgst: sgstFormatted,
//     igst: igstFormatted,
//     grandTotalCurrency,
//     grandTotal: grandTotalFormatted,
//     grandTotalInWords,
//     currencyCode,
//     currencySymbol: meta.symbol,
//     currencyLocale: meta.locale,
//     exchangeRate,
//     subTotalCurrencyRaw: subTotalCurrency,
//     grandTotalCurrencyRaw: grandTotalCurrency,
//     otherCharges: otherCharges.map((c) => ({
//       ...c,
//       amountRaw: Number(c.amount || c.value || 0),
//       amount: formatNumberOnly(
//         Number(c.amount || c.value || 0),
//         currencyCode,
//         4
//       ),
//     })),
//     gstLabel,
//   });

//   const browser = await puppeteer.launch({
//     headless: true,
//     args: [
//       "--no-sandbox",
//       "--disable-setuid-sandbox",
//       "--disable-dev-shm-usage",
//       "--disable-extensions",
//       "--disable-background-timer-throttling",
//       "--disable-backgrounding-occluded-windows",
//     ],
//   });

//   try {
//     const page = await browser.newPage();
//     await page.setViewport({ width: 1200, height: 800 });
//     await page.setContent(html, { waitUntil: "domcontentloaded" });
//     return await page.pdf({
//       format: "A4",
//       printBackground: true,
//       margin: { top: 0, bottom: 0, left: 0, right: 0 },
//       preferCSSPageSize: true,
//     });
//   } finally {
//     await browser.close();
//   }
// }

// module.exports = generatePOBuffer;

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const Decimal = require("decimal.js");
const puppeteer = require("puppeteer");
const numberToWords = require("./numberToWords"); // INR words

const CURRENCY_META = {
  INR: { locale: "en-IN", symbol: "₹", fractionDigits: 2 },
  USD: { locale: "en-US", symbol: "$", fractionDigits: 2 },
  EUR: { locale: "de-DE", symbol: "€", fractionDigits: 2 },
  GBP: { locale: "en-GB", symbol: "£", fractionDigits: 2 },
  AED: { locale: "en-AE", symbol: "د.إ", fractionDigits: 2 },
};

function getCurrencyMeta(code = "INR") {
  return (
    CURRENCY_META[code] || { locale: "en-US", symbol: code, fractionDigits: 2 }
  );
}

function amountToWords(amount, currencyCode = "INR") {
  const rounded = Math.round(Number(amount || 0) * 100) / 100;
  try {
    return numberToWords(rounded, currencyCode);
  } catch {
    return `${rounded} ${currencyCode}`;
  }
}

function getGSTLabel(po) {
  const gstType = (po.gstType || "").toString();
  if (gstType.includes("ITEMWISE") || gstType.includes("EXEMPTED")) return "";
  if (gstType.startsWith("IGST_")) return `IGST @ ${gstType.split("_")[1]}%`;
  if (gstType.startsWith("LGST_")) {
    const rate = gstType.split("_")[1];
    return `CGST @ ${rate / 2}% + SGST @ ${rate / 2}%`;
  }
  return "";
}

function fixNum(val, d = 4) {
  return new Decimal(val ?? "0") // STRING OR DECIMAL
    .toDecimalPlaces(d, Decimal.ROUND_DOWN)
    .toNumber();
}

function addNum(a, b, d = 4) {
  return new Decimal(a ?? "0")
    .plus(new Decimal(b ?? "0"))
    .toDecimalPlaces(d, Decimal.ROUND_DOWN)
    .toNumber();
}

function formatNumberOnly(val, currencyCode, decimals) {
  const meta = getCurrencyMeta(currencyCode);

  const str = new Decimal(val || 0)
    .toDecimalPlaces(decimals, Decimal.ROUND_DOWN)
    .toFixed(decimals);

  return Number(str).toLocaleString(meta.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatWithDecimals(val, currencyCode, decimals) {
  const meta = getCurrencyMeta(currencyCode);

  const str = new Decimal(val || 0)
    .toDecimalPlaces(decimals, Decimal.ROUND_DOWN)
    .toFixed(decimals);

  return `${meta.symbol} ${Number(str).toLocaleString(meta.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function roundGrandTotal(value) {
  const amount = new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  const integerPart = amount.floor();
  const decimalPart = amount.minus(integerPart);

  if (decimalPart.greaterThanOrEqualTo(new Decimal(0.5))) {
    return integerPart.plus(1).toDecimalPlaces(4, Decimal.ROUND_DOWN);
  }

  return integerPart.toDecimalPlaces(4, Decimal.ROUND_DOWN);
}


async function generatePOBuffer(po, items = []) {
  const tplPath = path.join(__dirname, "../templates/poTemplate.ejs");
  const tpl = fs.readFileSync(tplPath, "utf8");

  const currencyCode = po.currency?.toString() || "INR";
  const meta = getCurrencyMeta(currencyCode);
  const exchangeRate = Number(po.exchangeRate || 1);

  const gstType = (po.gstType || "").toUpperCase();
  const isItemWise = gstType.includes("ITEMWISE");
  const isExempted = gstType.includes("EXEMPTED");
  const isIGST = gstType.startsWith("IGST_");
  const isLGST = gstType.startsWith("LGST_");

  let totalQty = 0;
  let subtotalCurrency = 0;
  let totalOtherChargesCurrency = 0;

  // Prepare item rows
  const preparedRows = (items || []).map((it, i) => {
    const qty = fixNum(it.quantity, 4);
    const rate = fixNum(it.rate, 4);
    const lineAmount = fixNum(
      po.currency === "INR" ? it.total : it.amountInForeign,
      4
    );

    totalQty = addNum(totalQty, qty, 4);
    subtotalCurrency = addNum(subtotalCurrency, lineAmount, 4);

    let gstRate = 0;
    let gstAmount = 0;
    let finalAmount = lineAmount;

    if (isItemWise) {
      gstRate = Number(it.gstRate || 0);
      gstAmount = fixNum(new Decimal(lineAmount).mul(gstRate).div(100), 4);

      finalAmount = addNum(finalAmount, gstAmount, 4);
    }
   
    return {
      sno: it.serial_no ?? i + 1,
      itemName: it.itemName || "",
      modelNumber: it.modelNumber || "",
      itemDetail: it.itemDetail ? String(it.itemDetail) : "",
      hsn: it.hsnCode || "",
      qty,
      unit: it.unit || "Nos",
      rateRaw: rate,
      rate: formatNumberOnly(rate, currencyCode, 4),
      lineAmountRaw: lineAmount,
      lineAmount: formatNumberOnly(lineAmount, currencyCode, 4),
      gstRate: isItemWise ? `${gstRate}%` : "",
      gstAmountRaw: gstAmount,
      gstAmount: isItemWise ? formatNumberOnly(gstAmount, currencyCode, 4) : "",
      amountRaw: finalAmount,
      amount: formatNumberOnly(finalAmount, currencyCode, 4),
    };
  });

  // Other charges
  const otherCharges = po.otherCharges || [];
  for (const ch of otherCharges) {
    const amt = ch?.amount ?? ch?.value ?? "0";
    totalOtherChargesCurrency = addNum(totalOtherChargesCurrency, amt, 4);
  }

  const subTotalCurrency = subtotalCurrency;

  let totalCGST = 0,
    totalSGST = 0,
    totalIGST = 0,
    totalGST = 0,
    grandTotalCurrency = 0;

  if (isItemWise) {
    totalGST = preparedRows.reduce(
      (acc, r) => addNum(acc, r.gstAmountRaw || 0, 4),
      0
    );

    const itemsTotal = preparedRows.reduce(
      (acc, r) => addNum(acc, r.amountRaw || 0, 4),
      0
    );
    grandTotalCurrency = addNum(itemsTotal, totalOtherChargesCurrency, 4);
    
  } else if (isExempted) {
    totalGST = 0;
    grandTotalCurrency = fixNum(
      subTotalCurrency + totalOtherChargesCurrency,
      4
    );
  } else {
    const taxableAmount = fixNum(
      subTotalCurrency + totalOtherChargesCurrency,
      4
    );

    const rate = Number(po.gstRate || gstType.split("_")[1] || 0);

    if (isIGST) {
      totalIGST = fixNum(new Decimal(taxableAmount).mul(rate).div(100), 4);
      totalGST = totalIGST;
      grandTotalCurrency = addNum(taxableAmount, totalGST, 4);
    } else if (isLGST) {
      totalCGST = fixNum((taxableAmount * rate) / 2 / 100, 4);
      totalSGST = fixNum((taxableAmount * rate) / 2 / 100, 4);
      totalGST = fixNum(totalCGST + totalSGST, 4);
      grandTotalCurrency = fixNum(taxableAmount + totalGST, 4);
    } else {
      totalGST = 0;
      grandTotalCurrency = taxableAmount;
    }
  }
  grandTotalCurrency = roundGrandTotal(grandTotalCurrency).toNumber();
  const gstLabel = getGSTLabel(po);
  const grandTotalInWords = amountToWords(grandTotalCurrency, currencyCode);

  // Paginate rows
  const pages = (function paginateRows(preparedRowsLocal) {
    const FULL_PAGE = 7;
    const FOOTER_PAGE = 6;
    let rows = [...preparedRowsLocal];
    let pagesArr = [];
    const pushPage = (arr, padTo = FULL_PAGE) => {
      while (arr.length < padTo) arr.push(null);
      pagesArr.push(arr);
    };
    if (rows.length < FULL_PAGE) {
      pushPage(rows.splice(0), FOOTER_PAGE);
      return pagesArr;
    }
    if (rows.length === FULL_PAGE) {
      pushPage(rows.splice(0, FULL_PAGE - 1), FULL_PAGE);
      pushPage(rows.splice(0, 1), FOOTER_PAGE);
      return pagesArr;
    }
    if (rows.length % FULL_PAGE === 0) {
      while (rows.length > FULL_PAGE) pushPage(rows.splice(0, FULL_PAGE));
      pushPage(rows.splice(0, FULL_PAGE - 1));
      pushPage(rows.splice(0, 1), FOOTER_PAGE);
      return pagesArr;
    }
    while (rows.length > FULL_PAGE) pushPage(rows.splice(0, FULL_PAGE));
    if (rows.length > 0) pushPage(rows.splice(0, rows.length), FOOTER_PAGE);
    return pagesArr;
  })(preparedRows);

  // Formatted totals
  const grandTotalFormatted = formatWithDecimals(
    grandTotalCurrency,
    currencyCode,
    4
  );
  
  const totalOtherChargesFormatted = formatNumberOnly(
    totalOtherChargesCurrency,
    currencyCode,
    4
  );
  const totalGSTFormatted = formatNumberOnly(totalGST, currencyCode, 4);
  const cgstFormatted = formatNumberOnly(totalCGST, currencyCode, 4);
  const sgstFormatted = formatNumberOnly(totalSGST, currencyCode, 4);
  const igstFormatted = formatNumberOnly(totalIGST, currencyCode, 4);

  const html = ejs.render(tpl, {
    companyName: po.company?.name,
    companySub: po.company?.subtitle,
    companyAddress: po.company?.address,
    companyGST: po.company?.gstNumber,
    vendorName: po.vendor?.name,
    vendorAddress: po.vendor?.address,
    vendorGST: po.vendor?.gstNumber,
    vendorEmail: po.vendor?.email,
    vendorContactPerson: po.vendor?.contactPerson,
    vendorPhone: po.vendor?.contactNumber,
    poNumber: po.poNumber,
    poDate: new Date(po.createdAt).toLocaleDateString("en-IN"),
    paymentTerms: po.paymentTerms,
    deliveryTerms: po.deliveryTerms,
    contactPerson: po.contactPerson,
    cellNo: po.cellNo,
    warranty: po.warranty,
    gstType,
    gstRate: po.gstRate,
    rows: preparedRows,
    pages,
    totalQty,
    subTotalCurrency,
    totalOtherChargesCurrency,
    totalOtherCharges: totalOtherChargesFormatted,
    totalGSTCurrency: totalGST,
    totalGST: totalGSTFormatted,
    cgst: cgstFormatted,
    sgst: sgstFormatted,
    igst: igstFormatted,
    grandTotalCurrency,
    grandTotal: grandTotalFormatted,
    grandTotalInWords,
    currencyCode,
    currencySymbol: meta.symbol,
    currencyLocale: meta.locale,
    exchangeRate,
    subTotalCurrencyRaw: subTotalCurrency,
    grandTotalCurrencyRaw: grandTotalCurrency,
    otherCharges: otherCharges.map((c) => ({
      ...c,
      amountRaw: Number(c.amount || c.value || 0),
      amount: formatNumberOnly(
        Number(c.amount || c.value || 0),
        currencyCode,
        4
      ),
    })),
    gstLabel,
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
  } finally {
    await browser.close();
  }
}

module.exports = generatePOBuffer;
