const prisma = require("../../config/prismaClient");
const companyShortName = require("../../util/companyShortName");

//------------------- Payment List Helpers --------------------//

const PAYMENT_STAGES = {
  PENDING_DOCS: "Pending Docs Verification",
  PENDING_ADMIN: "Pending Admin Approval",
  PENDING_TRANSFER: "Pending Payment Transfer",
  PAID: "Paid",
  REJECTED_DOCS: "Rejected in Docs Verification",
  REJECTED_ADMIN: "Rejected by Admin",
  REJECTED_ACCOUNTS: "Rejected by Accounts",
  REJECTED: "Rejected",
};

const paymentSelect = {
  id: true,
  poId: true,
  debitNoteId: true,
  amount: true,
  billpaymentType: true,
  createdAt: true,
  docApprovalStatus: true,
  docApprovalDate: true,
  docApprovalRemark: true,
  adminApprovalStatus: true,
  adminApprovalDate: true,
  adminRemark: true,
  paymentStatus: true,
  paymentDate: true,
  paymentRemark: true,
  paymentRejected: true,
  paymentRejectedAt: true,
  paymentRequestedBy: true,
  payment_RequestedBy: { select: { name: true } },
  doc_ApprovedBy: { select: { name: true } },
  approvedBy_Admin: { select: { name: true } },
  payment_TransferredBy: { select: { name: true } },
  payment_RejectedBy: { select: { name: true } },
};

const getStageKey = (p) => {
  if (p.paymentRejected) return "REJECTED";
  if (p.paymentStatus === true) return "PAID";
  if (p.paymentStatus === false) return "REJECTED_ACCOUNTS";
  if (p.adminApprovalStatus === false) return "REJECTED_ADMIN";
  if (p.docApprovalStatus === false) return "REJECTED_DOCS";
  if (p.adminApprovalStatus === true) return "PENDING_TRANSFER";
  if (p.docApprovalStatus === true) return "PENDING_ADMIN";
  return "PENDING_DOCS";
};

const formatPayment = (p) => {
  const stageKey = getStageKey(p);
  return {
    paymentId: p.id,
    poId: p.poId,
    debitNoteId: p.debitNoteId || null,
    amount: Number(p.amount),
    billPaymentType: p.billpaymentType || null,
    stageKey,
    stage: PAYMENT_STAGES[stageKey],
    requestedById: p.paymentRequestedBy || null,
    requestedBy: p.payment_RequestedBy?.name || null,
    requestedAt: p.createdAt,
    docsVerification: {
      by: p.doc_ApprovedBy?.name || null,
      status: p.docApprovalStatus,
      date: p.docApprovalDate,
      remarks: p.docApprovalRemark,
    },
    adminVerification: {
      by: p.approvedBy_Admin?.name || null,
      status: p.adminApprovalStatus,
      date: p.adminApprovalDate,
      remarks: p.adminRemark,
    },
    accountsVerification: {
      by: p.payment_TransferredBy?.name || null,
      status: p.paymentStatus,
      date: p.paymentDate,
      remarks: p.paymentRemark,
    },
    rejection: p.paymentRejected
      ? { by: p.payment_RejectedBy?.name || null, date: p.paymentRejectedAt }
      : null,
  };
};

const toList = (v) =>
  v
    ? String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

const parseDate = (v, endOfDay = false) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SORT_FIELDS = ["poDate", "poNumber", "grandTotal", "totalPaid", "pendingAmount", "lastPaymentAt"];

//------------------- API --------------------//

/**
 * GET /payments
 *
 * PO filters:
 *   vendorId, companyId, poId, warehouseId   (comma separated allowed)
 *   poStatus      (comma separated POStatus values)
 *   currency      (comma separated, e.g. INR,USD)
 *   search        (poNumber / vendor name / company name)
 *   poFromDate, poToDate
 *   paymentStatusFlag = Pending | Completed     (PO fully paid or not)
 *   hasPayments   = true | false
 *
 * Payment filters (applied to each PO's payment history):
 *   stage         (comma separated: PENDING_DOCS, PENDING_ADMIN, PENDING_TRANSFER, PAID,
 *                  REJECTED_DOCS, REJECTED_ADMIN, REJECTED_ACCOUNTS, REJECTED, or PENDING / REJECTED_ALL)
 *   fromDate, toDate          (payment request date)
 *   paidFromDate, paidToDate  (payment transfer date)
 *   requestedBy   (userId, or "me")
 *   includeRejected = true    (show requests rejected by Purchase; default hidden)
 *
 * Sorting & paging:
 *   sortBy = poDate | poNumber | grandTotal | totalPaid | pendingAmount | lastPaymentAt
 *   sortOrder = asc | desc (default desc)
 *   page, limit   (no paging when neither is given)
 */
const getPaymentList = async (req, res) => {
  try {
    const q = req.query;

    // ---------- PO level (DB) filters ----------
    const poWhere = {
      grandTotal: { not: null },
      status: { not: "Cancelled" },
    };

    const vendorIds = toList(q.vendorId);
    const companyIds = toList(q.companyId);
    const poIds = toList(q.poId);
    const warehouseIds = toList(q.warehouseId);
    const poStatuses = toList(q.poStatus);
    const currencies = toList(q.currency).map((c) => c.toUpperCase());

    if (vendorIds.length) poWhere.vendorId = { in: vendorIds };
    if (companyIds.length) poWhere.companyId = { in: companyIds };
    if (poIds.length) poWhere.id = { in: poIds };
    if (warehouseIds.length) poWhere.warehouseId = { in: warehouseIds };
    if (poStatuses.length) poWhere.status = { in: poStatuses };
    if (currencies.length) poWhere.currency = { in: currencies };

    const poFrom = parseDate(q.poFromDate);
    const poTo = parseDate(q.poToDate, true);
    if (poFrom || poTo) {
      poWhere.poDate = {};
      if (poFrom) poWhere.poDate.gte = poFrom;
      if (poTo) poWhere.poDate.lte = poTo;
    }

    if (q.search && q.search.trim()) {
      const s = q.search.trim();
      poWhere.OR = [
        { poNumber: { contains: s } },
        { vendorName: { contains: s } },
        { companyName: { contains: s } },
        { vendor: { name: { contains: s } } },
        { company: { name: { contains: s } } },
      ];
    }

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: poWhere,
      orderBy: { poDate: "desc" },
      select: {
        id: true,
        poNumber: true,
        poDate: true,
        status: true,
        currency: true,
        grandTotal: true,
        foreignGrandTotal: true,
        companyId: true,
        companyName: true,
        vendorId: true,
        vendorName: true,
        warehouseId: true,
        warehouseName: true,
        company: { select: { name: true } },
        vendor: { select: { name: true } },
        // all payments: totals must not change with payment filters
        payments: { select: paymentSelect, orderBy: { createdAt: "desc" } },
      },
    });

    // ---------- Payment level filters ----------
    let stageKeys = toList(q.stage).map((s) => s.toUpperCase());
    if (stageKeys.includes("PENDING")) {
      stageKeys.push("PENDING_DOCS", "PENDING_ADMIN", "PENDING_TRANSFER");
    }
    if (stageKeys.includes("REJECTED_ALL")) {
      stageKeys.push("REJECTED_DOCS", "REJECTED_ADMIN", "REJECTED_ACCOUNTS", "REJECTED");
    }
    stageKeys = stageKeys.filter((k) => PAYMENT_STAGES[k]);

    const includeRejected =
      q.includeRejected === "true" || stageKeys.includes("REJECTED");

    const reqFrom = parseDate(q.fromDate);
    const reqTo = parseDate(q.toDate, true);
    const paidFrom = parseDate(q.paidFromDate);
    const paidTo = parseDate(q.paidToDate, true);
    const requestedBy = q.requestedBy === "me" ? req.user?.id : q.requestedBy;

    const paymentFilterActive = Boolean(
      stageKeys.length || reqFrom || reqTo || paidFrom || paidTo || requestedBy,
    );

    const matchPayment = (p) => {
      if (!includeRejected && p.stageKey === "REJECTED") return false;
      if (stageKeys.length && !stageKeys.includes(p.stageKey)) return false;
      if (reqFrom && p.requestedAt < reqFrom) return false;
      if (reqTo && p.requestedAt > reqTo) return false;
      if (paidFrom || paidTo) {
        const d = p.accountsVerification.date;
        if (!d) return false;
        if (paidFrom && d < paidFrom) return false;
        if (paidTo && d > paidTo) return false;
      }
      if (requestedBy && p.requestedById !== requestedBy) return false;
      return true;
    };

    // ---------- Build rows ----------
    let rows = purchaseOrders.map((po) => {
      const currency = (po.currency || "INR").toUpperCase();
      const grandTotal = Number(
        (currency === "INR" ? po.grandTotal : po.foreignGrandTotal) || 0,
      );

      const allPayments = po.payments.map(formatPayment);

      const totalPaid = round2(
        allPayments
          .filter((p) => p.stageKey === "PAID")
          .reduce((sum, p) => sum + p.amount, 0),
      );
      const totalInProcess = round2(
        allPayments
          .filter((p) => p.stageKey.startsWith("PENDING"))
          .reduce((sum, p) => sum + p.amount, 0),
      );
      const pendingAmount = round2(grandTotal - totalPaid);

      const payments = allPayments.filter(matchPayment);

      return {
        poId: po.id,
        poNumber: po.poNumber,
        poDate: po.poDate,
        poStatus: po.status,
        companyId: po.companyId,
        companyName: companyShortName(po.companyName || po.company?.name) || null,
        vendorId: po.vendorId,
        vendorName: po.vendorName || po.vendor?.name || null,
        warehouseId: po.warehouseId,
        warehouseName: po.warehouseName,
        currency,
        grandTotal,
        totalPaid,
        totalInProcess,
        pendingAmount,
        paymentStatusFlag: pendingAmount > 0 ? "Pending" : "Completed",
        lastPaymentAt: allPayments[0]?.requestedAt || null,
        paymentCount: payments.length,
        payments,
      };
    });

    // ---------- Computed (row level) filters ----------
    if (paymentFilterActive) rows = rows.filter((r) => r.paymentCount > 0);

    if (q.paymentStatusFlag) {
      const flag = q.paymentStatusFlag.toLowerCase();
      rows = rows.filter((r) => r.paymentStatusFlag.toLowerCase() === flag);
    }

    if (q.hasPayments === "true") rows = rows.filter((r) => r.paymentCount > 0);
    if (q.hasPayments === "false") rows = rows.filter((r) => r.paymentCount === 0);

    // ---------- Sorting ----------
    const sortBy = SORT_FIELDS.includes(q.sortBy) ? q.sortBy : "poDate";
    const dir = q.sortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    // ---------- Summary (on all filtered rows, before paging) ----------
    const summaryByCurrency = {};
    for (const r of rows) {
      const s = (summaryByCurrency[r.currency] ||= {
        currency: r.currency,
        totalPOs: 0,
        totalPOValue: 0,
        totalPaid: 0,
        totalInProcess: 0,
        totalPending: 0,
        totalPayments: 0,
      });
      s.totalPOs += 1;
      s.totalPOValue += r.grandTotal;
      s.totalPaid += r.totalPaid;
      s.totalInProcess += r.totalInProcess;
      s.totalPending += r.pendingAmount;
      s.totalPayments += r.paymentCount;
    }

    // ---------- Paging ----------
    const total = rows.length;
    let pagination = null;
    if (q.page || q.limit) {
      const page = Math.max(parseInt(q.page) || 1, 1);
      const limit = Math.min(Math.max(parseInt(q.limit) || 20, 1), 500);
      rows = rows.slice((page - 1) * limit, page * limit);
      pagination = { page, limit, total, totalPages: Math.ceil(total / limit) };
    }

    return res.status(200).json({
      success: true,
      message: "Payment list fetched successfully",
      summary: Object.values(summaryByCurrency).map((s) => ({
        ...s,
        totalPOValue: round2(s.totalPOValue),
        totalPaid: round2(s.totalPaid),
        totalInProcess: round2(s.totalInProcess),
        totalPending: round2(s.totalPending),
      })),
      pagination,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("PAYMENT LIST ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

module.exports = {
  getPaymentList,
};
