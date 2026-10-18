import { formatGBP } from "./money.js";
import { nextInvoiceNumber } from "./storage.js";

const PAGE_MARGIN = 16;
const PAGE_FOOTER = 9;

function plain(value) {
  return String(value ?? "").trim();
}

function safeFilename(value) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return safe || "Client";
}

function dateDDMMYYYY(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plain(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function datesInText(value) {
  return String(value ?? "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
}

async function fetchDataUrl(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

function addSignatureFont(doc, fontBase64) {
  doc.addFileToVFS("GreatVibes-Regular.ttf", fontBase64);
  doc.addFont("GreatVibes-Regular.ttf", "GreatVibes", "normal");
  doc.setFont("GreatVibes", "normal");
  doc.getTextWidth("Signature test");
}

async function loadSignatureFont() {
  const response = await fetch("./fonts/GreatVibes-Regular.ttf");
  if (!response.ok) throw new Error(`Could not load signature font (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function settingsLines(settings, keys) {
  return keys.map((key) => plain(settings[key])).filter(Boolean);
}

function paymentLines(settings, totals, quote) {
  const depositDue = dateDDMMYYYY(quote.inputs.quoteDate);
  const balanceDue = dateDDMMYYYY(totals.dueImmediately ? quote.inputs.quoteDate : totals.balanceDueDate);
  const bank = Object.fromEntries([
    "bank_name",
    "account_name",
    "sort_code",
    "account_number",
    "iban",
    "swift"
  ].map((key) => [key, plain(settings[key])]));
  return [
    `Deposit: ${formatGBP(totals.depositGBP)} due ${depositDue} | Balance: ${formatGBP(totals.balanceGBP)} due ${balanceDue}`,
    [bank.bank_name && `Bank: ${bank.bank_name}`, bank.account_name && `Account name: ${bank.account_name}`].filter(Boolean).join(" | "),
    [bank.sort_code && `Sort code: ${bank.sort_code}`, bank.account_number && `Account number: ${bank.account_number}`].filter(Boolean).join(" | "),
    [bank.iban && `IBAN: ${bank.iban}`, bank.swift && `SWIFT: ${bank.swift}`].filter(Boolean).join(" | ")
  ];
}

export async function generateInvoicePdf({ quote, settings, jsPDF = globalThis.jspdf?.jsPDF }) {
  if (!quote?.result || quote.result.errors?.length) {
    return { invoiceNumber: null, error: "Fix the quote errors before creating an invoice." };
  }
  if (typeof jsPDF !== "function") {
    return { invoiceNumber: null, error: "The PDF libraries are unavailable. Check your connection and reload." };
  }

  const issueDate = plain(quote.inputs.quoteDate);
  const invoiceYear = issueDate.slice(0, 4);
  const prefix = settings.invoice_prefix || "PF";
  const existingInvoiceNumber = quote.invoiceNumber?.startsWith(`${prefix}-${invoiceYear}-`)
    ? quote.invoiceNumber
    : null;
  const reservation = existingInvoiceNumber
    ? { invoiceNumber: existingInvoiceNumber, error: null }
    : nextInvoiceNumber(prefix, invoiceYear);
  const { invoiceNumber } = reservation;
  if (!invoiceNumber) {
    return { invoiceNumber: null, error: reservation.error };
  }

  try {
    const [logoDataUrl, signatureFont] = await Promise.all([
      fetchDataUrl("./logo.png"),
      loadSignatureFont().catch(() => null)
    ]);
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const tableWidth = pageWidth - PAGE_MARGIN * 2;
    const right = pageWidth - PAGE_MARGIN;
    const client = plain(quote.inputs.clientName);
    const { totals } = quote.result;
    let hasSignatureFont = false;
    if (signatureFont) {
      try {
        addSignatureFont(doc, signatureFont);
        hasSignatureFont = true;
      } catch {
        hasSignatureFont = false;
      }
    }

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
    doc.addImage(logoDataUrl, "PNG", PAGE_MARGIN, 25, 55, 55);

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(22);
    doc.text("PRO FORMA INVOICE", right, 29, { align: "right", charSpace: 0.8 });

    const companyName = plain(settings.company_name);
    const companyLines = settingsLines(settings, [
      "company_address_line_1",
      "company_address_line_2",
      "company_address_line_3"
    ]);
    if (!companyLines.length && plain(settings.company_address)) companyLines.push(plain(settings.company_address));
    doc.setTextColor(128, 128, 128);
    doc.setFontSize(10);
    let companyY = 39;
    if (companyName) {
      doc.setFont("helvetica", "bold");
      doc.text(companyName, right, companyY, { align: "right" });
      companyY += 4.5;
    }
    doc.setFont("helvetica", "normal");
    if (companyLines.length) {
      doc.text(companyLines, right, companyY, { align: "right", lineHeightFactor: 1.2 });
      companyY += companyLines.length * 4.2 + 4.5;
    }
    if (plain(settings.company_email)) {
      doc.text(plain(settings.company_email), right, companyY, { align: "right" });
    }

    const clientLines = [
      client,
      plain(quote.inputs.leadTraveller),
      plain(quote.inputs.email),
      plain(quote.inputs.phone)
    ].filter(Boolean);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(clientLines, PAGE_MARGIN + 2, 88, { lineHeightFactor: 1.3 });

    const infoX = PAGE_MARGIN + tableWidth * 0.5;
    const valueX = right;
    const infoRows = [
      { label: "Pro forma invoice No.:", value: invoiceNumber, y: 88 },
      { label: "Issue date:", value: dateDDMMYYYY(issueDate), y: 93 },
      { label: "Due date:", value: dateDDMMYYYY(issueDate), y: 98 },
      { label: "Reference:", value: plain(quote.id), y: 108, size: 7.5 },
      { label: "Travel dates:", value: `${dateDDMMYYYY(quote.inputs.checkIn)} to ${dateDDMMYYYY(quote.inputs.checkOut)}`, y: 115 }
    ];
    infoRows.forEach(({ label, value, y, size = 9.5 }) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(label, infoX, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      doc.text(value, valueX, y, { align: "right" });
    });

    const body = quote.result.lines
      .filter((line) => !line.internalOnly)
      .map((line) => [
        datesInText(line.description),
        String(line.quantity),
        formatGBP(line.unitPriceGBP),
        formatGBP(line.totalSellGBP)
      ]);
    doc.autoTable({
      startY: 120,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: 54 },
      tableWidth,
      head: [["DESCRIPTION", "QUANTITY", "UNIT PRICE (£)", "AMOUNT (£)"]],
      body,
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 8,
        textColor: 0,
        lineColor: [217, 217, 217],
        lineWidth: { top: 0, right: 0, bottom: 0.18, left: 0 },
        cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
        overflow: "linebreak",
        valign: "middle"
      },
      headStyles: {
        fontStyle: "bold",
        fillColor: [197, 202, 206],
        textColor: 0,
        lineWidth: 0,
        cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 }
      },
      columnStyles: {
        0: { cellWidth: 100, halign: "left" },
        1: { cellWidth: 22, halign: "right" },
        2: { cellWidth: 30, halign: "right" },
        3: { cellWidth: 26, halign: "right" }
      },
      didParseCell: (context) => {
        if (context.section === "head" && context.column.index > 0) context.cell.styles.halign = "right";
      }
    });

    let totalsY = doc.lastAutoTable.finalY + 8;
    const paymentTerms = plain(settings.terms_text);
    const wrappedTerms = paymentTerms ? doc.splitTextToSize(paymentTerms, tableWidth) : [];
    const bankLines = paymentLines(settings, totals, quote);
    const wrappedBankLines = bankLines.flatMap((line) => doc.splitTextToSize(line, tableWidth));
    const paymentTextLines = wrappedBankLines.length + wrappedTerms.length + (paymentTerms ? 1 : 0) + 1;
    const paymentHeight = 7 + paymentTextLines * 3.6 + 7;
    const paymentY = pageHeight - PAGE_FOOTER - paymentHeight;
    const totalX = PAGE_MARGIN + tableWidth * 0.54;
    if (totalsY + 35 > paymentY - 4) {
      doc.addPage();
      totalsY = 23;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 51, 51);
    doc.text("TOTAL (GBP):", totalX, totalsY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(128, 128, 128);
    doc.text(formatGBP(totals.totalSellGBP), right, totalsY, { align: "right" });
    doc.setDrawColor(174, 174, 174);
    doc.setLineWidth(0.25);
    doc.line(totalX, totalsY + 5, right, totalsY + 5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 51, 51);
    doc.setFontSize(16);
    doc.text("TOTAL DUE (GBP)", totalX, totalsY + 13);
    doc.text(formatGBP(totals.totalSellGBP), right, totalsY + 13, { align: "right" });

    const signatureY = totalsY + 25;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(0, 0, 0);
    doc.text("Issued by, signature:", right, signatureY, { align: "right" });
    doc.setFont(hasSignatureFont ? "GreatVibes" : "times", hasSignatureFont ? "normal" : "italic");
    doc.setFontSize(hasSignatureFont ? 22 : 16);
    doc.text(companyName, right, signatureY + 10, { align: "right" });

    doc.setDrawColor(217, 217, 217);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, paymentY - 4, right, paymentY - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(112, 112, 112);
    const paymentText = [
      ...wrappedBankLines,
      ...(wrappedTerms.length ? [`Terms: ${wrappedTerms.shift()}`, ...wrappedTerms] : []),
      "This is a pro forma invoice and not a VAT invoice."
    ];
    doc.text(paymentText, PAGE_MARGIN, paymentY, { lineHeightFactor: 1.15 });

    const pageCount = doc.internal.getNumberOfPages();
    if (pageCount > 1) {
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(112, 112, 112);
        doc.text(`Page ${page} of ${pageCount}`, right, pageHeight - 4, { align: "right" });
      }
    }

    return {
      invoiceNumber,
      filename: `${invoiceNumber}_${safeFilename(client)}.pdf`,
      blob: doc.output("blob"),
      error: null
    };
  } catch (error) {
    return { invoiceNumber, error: `The PDF could not be generated: ${error.message}` };
  }
}
