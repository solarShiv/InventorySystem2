const ExcelJS = require("exceljs");
const prisma = require("../config/prismaClient");
const exportPurchaseOrders = async (req, res) => {
    try {
        const purchaseOrders = await prisma.purchaseOrder.findMany({
            include: {
                items: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        const workbook = new ExcelJS.Workbook();

        // =====================================================
        // SHEET 1: PURCHASE ORDERS
        // =====================================================

        const poSheet = workbook.addWorksheet("Purchase Orders");

        poSheet.columns = [
            { header: "id", key:"id", width:38},
            { header: "PO Number", key: "poNumber", width: 20 },
            { header: "Financial Year", key: "financialYear", width: 18 },
            { header: "Company ID", key: "companyId", width: 38 },
            { header: "Company Name", key: "companyName", width: 25 },
            { header: "Vendor ID", key: "vendorId", width: 38 },
            { header: "Vendor Name", key: "vendorName", width: 25 },

            { header: "PO Date", key: "poDate", width: 20 },
            { header: "GST Type", key: "gstType", width: 15 },

            { header: "Sub Total", key: "subTotal", width: 18 },
            { header: "CGST", key: "totalCGST", width: 18 },
            { header: "SGST", key: "totalSGST", width: 18 },
            { header: "IGST", key: "totalIGST", width: 18 },
            { header: "Total GST", key: "totalGST", width: 18 },
            { header: "Grand Total", key: "grandTotal", width: 20 },

            { header: "Status", key: "status", width: 15 },
            { header: "Approval Status", key: "approvalStatus", width: 20 },

            { header: "Currency", key: "currency", width: 12 },
            { header: "Exchange Rate", key: "exchangeRate", width: 18 },
            { header: "Foreign Sub Total", key: "foreignSubTotal", width: 20 },
            { header: "Foreign Grand Total", key: "foreignGrandTotal", width: 22 },

            { header: "GST Rate", key: "gstRate", width: 15 },

            { header: "Remarks", key: "remarks", width: 30 },
            { header: "Payment Terms", key: "paymentTerms", width: 30 },
            { header: "Delivery Terms", key: "deliveryTerms", width: 30 },
            { header: "Contact Person", key: "contactPerson", width: 25 },
            { header: "Cell No", key: "cellNo", width: 18 },
            { header: "Warranty", key: "warranty", width: 25 },

            { header: "Warehouse ID", key: "warehouseId", width: 38 },
            { header: "Warehouse Name", key: "warehouseName", width: 25 },
            {
                header: "Expected Delivery Date",
                key: "expectedDeliveryDate",
                width: 22,
            },

            { header: "Fixed Grand Total", key: "fixedGrandTotal", width: 20 },

            { header: "Heading", key: "heading", width: 30 },

            { header: "Created At", key: "createdAt", width: 22 },
            { header: "Updated At", key: "updatedAt", width: 22 },

            { header: "Approved At", key: "approvedAt", width: 22 },
            { header: "Approved By", key: "approvedBy", width: 38 },

            { header: "Rejection Reason", key: "rejectionReason", width: 30 },

            { header: "Rejected At", key: "rejectedAt", width: 22 },
            { header: "Rejected By", key: "rejectedBy", width: 38 },

            { header: "Email Sent At", key: "emailSentAt", width: 22 },
            { header: "Email Sent By", key: "emailSentBy", width: 38 },

            { header: "Email Resent Count", key: "emailResentCount", width: 20 },

            { header: "PDF Name", key: "pdfName", width: 30 },
            { header: "PDF URL", key: "pdfUrl", width: 50 },
        ];

        // Header formatting
        poSheet.getRow(1).font = {
            bold: true,
        };

        poSheet.getRow(1).alignment = {
            vertical: "middle",
            horizontal: "center",
        };

        // =====================================================
        // ADD PURCHASE ORDER DATA
        // =====================================================

        purchaseOrders.forEach((po) => {
            poSheet.addRow({
                id:po.id,
                poNumber: po.poNumber,
                financialYear: po.financialYear,
                companyId: po.companyId,
                companyName: po.companyName,

                vendorId: po.vendorId,
                vendorName: po.vendorName,

                poDate: po.poDate,

                gstType: po.gstType,

                subTotal: po.subTotal?.toString(),
                totalCGST: po.totalCGST?.toString(),
                totalSGST: po.totalSGST?.toString(),
                totalIGST: po.totalIGST?.toString(),
                totalGST: po.totalGST?.toString(),
                grandTotal: po.grandTotal?.toString(),

                status: po.status,
                approvalStatus: po.approvalStatus,

                currency: po.currency,

                exchangeRate: po.exchangeRate?.toString(),

                foreignSubTotal: po.foreignSubTotal?.toString(),
                foreignGrandTotal: po.foreignGrandTotal?.toString(),

                gstRate: po.gstRate?.toString(),

                remarks: po.remarks,
                paymentTerms: po.paymentTerms,
                deliveryTerms: po.deliveryTerms,

                contactPerson: po.contactPerson,
                cellNo: po.cellNo,
                warranty: po.warranty,

                warehouseId: po.warehouseId,
                warehouseName: po.warehouseName,

                expectedDeliveryDate: po.expectedDeliveryDate,

                fixedGrandTotal: po.fixedGrandTotal?.toString(),

                heading: po.heading,

                createdAt: po.createdAt,
                updatedAt: po.updatedAt,

                approvedAt: po.approvedAt,
                approvedBy: po.approvedBy,

                rejectionReason: po.rejectionReason,

                rejectedAt: po.rejectedAt,
                rejectedBy: po.rejectedBy,

                emailSentAt: po.emailSentAt,
                emailSentBy: po.emailSentBy,

                emailResentCount: po.emailResentCount,

                pdfName: po.pdfName,
                pdfUrl: po.pdfUrl,
            });
        });

        // =====================================================
        // SHEET 2: PO ITEMS
        // =====================================================

        const itemSheet = workbook.addWorksheet("PO Items");

        itemSheet.columns = [
            { header: "PO Number", key: "poNumber", width: 20 },
            { header: "PO ID", key: "poId", width: 38 },
            { header: "Item ID", key: "itemId", width: 38 },
            { header: "Item Name", key: "itemName", width: 35 },
            { header: "Quantity", key: "quantity", width: 15 },
            { header: "Rate", key: "rate", width: 18 },
            { header: "Amount", key: "amount", width: 18 },
        ];

        itemSheet.getRow(1).font = {
            bold: true,
        };

        // =====================================================
        // ADD ITEMS
        // =====================================================

        purchaseOrders.forEach((po) => {
            if (!po.items) return;

            po.items.forEach((item) => {
                itemSheet.addRow({
                    poNumber: po.poNumber,
                    poId: po.id,
                    itemId: item.id,
                    itemName: item.itemName,
                    quantity: item.quantity,
                    rate: item.rate?.toString(),
                    amount: item.amount?.toString(),
                });
            });
        });

        // =====================================================
        // RESPONSE
        // =====================================================

        const fileName = `PurchaseOrders_${new Date()
            .toISOString()
            .split("T")[0]}.xlsx`;

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        await workbook.xlsx.write(res);

        res.end();
    } catch (error) {
        console.error("Purchase Order Excel Export Error:", error);

        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: "Failed to export purchase orders",
                error: error.message,
            });
        }
    }
};
const downloadCompaniesExcel = async (req, res) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Companies");

    worksheet.columns = [
      { header: "id", key: "id", width: 40 },
      { header: "Company Name", key: "name", width: 30 },
      { header: "Company Code", key: "companyCode", width: 20 },
      { header: "GST Number", key: "gstNumber", width: 20 },
      { header: "Address", key: "address", width: 40 },
      { header: "City", key: "city", width: 20 },
      { header: "State", key: "state", width: 20 },
      { header: "Pincode", key: "pincode", width: 15 },
      { header: "Contact Number", key: "contactNumber", width: 20 },
      { header: "Alternate Number", key: "alternateNumber", width: 20 },
      { header: "Email", key: "email", width: 30 },
      { header: "Country", key: "country", width: 15 },
      { header: "Currency", key: "currency", width: 15 },
      { header: "Created At", key: "createdAt", width: 25 },
    ];

    companies.forEach((company) => {
      worksheet.addRow(company);
    });

    // Header styling
    worksheet.getRow(1).font = {
      bold: true,
    };

    worksheet.getRow(1).alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    // Excel download headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="companies-${Date.now()}.xlsx"`
    );

    await workbook.xlsx.write(res);

    res.end();
  } catch (error) {
    console.error("Excel export error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to export companies data",
      error: error.message,
    });
  }
};

const downloadVendorExcel = async (req, res) => {
  try {
    // Fetch all vendor records
    const vendors = await prisma.vendor.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Vendors");

    // Get all fields from the Vendor model
    // Keep the exact Prisma field names
    const columns = [
      "id",
      "name",
      "email",
      "gstNumber",
      "address",
      "city",
      "state",
      "pincode",
      "country",
      "currency",
      "contactNumber",
      "alternateNumber",
      "createdBy",
      "createdAt",
      "updatedAt",
      "exchangeRate",
      "isActive",
      "contactPerson",
      "accountHolder",
      "accountNumber",
      "bankName",
      "ifscCode",
      "vendorAadhaar",
      "vendorPanCard",
      "aadhaarUrl",
      "pancardUrl",
      "contactNoVerified",
      "mailVerified",
      "zipCode",
      "referenceBy",
    ];

    // Excel headers
    worksheet.columns = columns.map((field) => ({
      header: field,
      key: field,
      width: 25,
    }));

    // Add vendor data
    vendors.forEach((vendor) => {
      const row = {};

      columns.forEach((field) => {
        let value = vendor[field];

        // Convert Decimal to string
        if (value && value.constructor?.name === "Decimal") {
          value = value.toString();
        }

        // Convert DateTime to readable value
        if (value instanceof Date) {
          value = value.toISOString();
        }

        row[field] = value ?? "";
      });

      worksheet.addRow(row);
    });

    // Header formatting
    worksheet.getRow(1).font = {
      bold: true,
    };

    worksheet.getRow(1).alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    // Freeze header row
    worksheet.views = [
      {
        state: "frozen",
        ySplit: 1,
      },
    ];

    // Auto filter
    worksheet.autoFilter = {
      from: "A1",
      to: `${String.fromCharCode(64 + columns.length)}1`,
    };

    // Set response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=vendors_${Date.now()}.xlsx`
    );

    // Send Excel file
    await workbook.xlsx.write(res);

    res.end();
  } catch (error) {
    console.error("Vendor Excel Download Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to download vendor list",
      error: error.message,
    });
  }
};
module.exports = {
    exportPurchaseOrders,
    downloadCompaniesExcel,
    downloadVendorExcel
};