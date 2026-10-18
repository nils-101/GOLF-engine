import { formatDate, todayISO } from "./dates.js";
import { formatGBP } from "./money.js";
import { nextInvoiceNumber } from "./storage.js";

function plain(value) {
  return String(value ?? "").trim();
}

function safeFilename(value) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const safe = normalized.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return safe || "Client";
}

function textOrPlaceholder(settings, key) {
  return plain(settings[key]) || "Not provided";
}

export function generateInvoicePdf({ quote, data, settings, jsPDF = globalThis.jspdf?.jsPDF }) {
  if (!quote?.result || quote.result.errors?.length) return { invoiceNumber: null, error: "Save a valid quote before creating an invoice." };
  if (typeof jsPDF !== "function") return { invoiceNumber: null, error: "The PDF libraries are unavailable. Check your connection and reload." };
  const issueDate = quote.inputs.quoteDate || todayISO();
  const invoiceYear = issueDate.slice(0, 4);
  const { invoiceNumber, error } = nextInvoiceNumber(settings.invoice_prefix || "PF", invoiceYear);
  if (error) return { invoiceNumber: null, error };

  try {
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 17;
    const tableWidth = pageWidth - margin * 2;
    const client = plain(quote.inputs.clientName);
    const result = quote.result;
    const totals = result.totals;
    const roomSummary = (quote.inputs.roomLines || []).map((line) => {
      const firstRate = data.hotels.records.find((row) =>
        row.hotel === quote.inputs.hotel && row.room_type === line.roomType
      );
      const board = firstRate?.board_basis || "";
      return `${line.rooms} x ${line.roomType}${board ? `, ${board}` : ""} (${line.occupancy} per room)`;
    }).join("; ");

    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setFont("times", "bold");
    doc.setFontSize(19);
    doc.text(textOrPlaceholder(settings, "company_name"), margin, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const companyDetails = [
      textOrPlaceholder(settings, "company_address"),
      `${textOrPlaceholder(settings, "company_email")}  |  ${textOrPlaceholder(settings, "company_phone")}`
    ];
    doc.text(companyDetails, margin, 27, { lineHeightFactor: 1.35 });

    const metaX = pageWidth - margin;
    doc.setFont("times", "bold");
    doc.setFontSize(20);
    doc.text("Pro forma invoice", metaX, 48, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const metadata = [
      `Invoice no.  ${invoiceNumber}`,
      `Issue date  ${formatDate(issueDate)}`,
      `Valid until  ${formatDate(totals.validUntil)}`
    ];
    metadata.forEach((line, index) => doc.text(line, metaX, 56 + index * 5, { align: "right" }));

    doc.setLineWidth(0.3);
    doc.line(margin, 73, pageWidth - margin, 73);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("CLIENT", margin, 81);
    doc.text("TRAVEL DETAILS", margin + tableWidth / 2, 81);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const clientDetails = [
      client,
      quote.inputs.leadTraveller ? `Lead traveller: ${quote.inputs.leadTraveller}` : "",
      quote.inputs.email || "",
      quote.inputs.phone || ""
    ].filter(Boolean);
    const travelDetails = [
      `${formatDate(quote.inputs.checkIn)} to ${formatDate(quote.inputs.checkOut)} (${result.stay.nights} nights)`,
      quote.inputs.hotel || "",
      roomSummary
    ].filter(Boolean);
    doc.text(clientDetails, margin, 87, { lineHeightFactor: 1.4 });
    doc.text(doc.splitTextToSize(travelDetails.join("\n"), tableWidth / 2 - 5), margin + tableWidth / 2, 87, { lineHeightFactor: 1.4 });

    const body = result.lines.filter((line) => !line.internalOnly && (line.totalSellGBP !== 0 || line.type !== "discount"))
      .map((line) => [
        line.description,
        String(line.quantity),
        formatGBP(line.unitPriceGBP),
        formatGBP(line.totalSellGBP)
      ]);
    doc.autoTable({
      startY: 111,
      margin: { left: margin, right: margin },
      tableWidth,
      head: [["Description", "Qty", "Unit price (GBP)", "Amount (GBP)"]],
      body,
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 8,
        textColor: 0,
        lineColor: 150,
        lineWidth: 0.15,
        cellPadding: 2.6,
        overflow: "linebreak"
      },
      headStyles: { fontStyle: "bold", fillColor: [235, 235, 235], textColor: 0, lineColor: 0, lineWidth: 0.25 },
      columnStyles: {
        0: { cellWidth: tableWidth - 77 },
        1: { cellWidth: 13, halign: "right" },
        2: { cellWidth: 32, halign: "right" },
        3: { cellWidth: 32, halign: "right" }
      },
    });

    let y = doc.lastAutoTable.finalY + 9;
    const pageHeight = doc.internal.pageSize.getHeight();
    if (y + 46 > pageHeight - 17) {
      doc.addPage();
      y = 20;
    }
    const labelX = pageWidth - margin - 83;
    doc.setLineWidth(0.3);
    doc.line(labelX, y, pageWidth - margin, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Total (GBP)", labelX, y + 7);
    doc.setFontSize(12);
    doc.text(formatGBP(totals.totalSellGBP), pageWidth - margin, y + 7, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Deposit (${settings.deposit_percent || 30}%): ${formatGBP(totals.depositGBP)}`, labelX, y + 15);
    doc.text(`Amount due now: ${formatGBP(totals.amountDueNowGBP)}${totals.dueImmediately ? " (full amount due now)" : ""}`, labelX, y + 21);
    const balanceDue = totals.dueImmediately
      ? "Full amount due immediately"
      : `Balance (${formatGBP(totals.balanceGBP)}) due ${formatDate(totals.balanceDueDate)}`;
    doc.text(balanceDue, labelX, y + 27);

    y += 37;
    if (y + 47 > pageHeight - 17) {
      doc.addPage();
      y = 20;
    }
    doc.line(margin, y, pageWidth - margin, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Payment details", margin, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const bankDetails = [
      `${textOrPlaceholder(settings, "bank_name")} | Account name: ${textOrPlaceholder(settings, "account_name")}`,
      `Sort code: ${textOrPlaceholder(settings, "sort_code")} | Account no.: ${textOrPlaceholder(settings, "account_number")}`,
      `IBAN: ${textOrPlaceholder(settings, "iban")} | SWIFT: ${textOrPlaceholder(settings, "swift")}`
    ];
    doc.text(bankDetails, margin, y + 13, { lineHeightFactor: 1.4 });
    const termsStart = y + 30;
    const terms = doc.splitTextToSize(settings.terms_text || "A 30% deposit confirms your booking. The remaining balance is due before travel.", tableWidth);
    doc.text(terms, margin, termsStart, { lineHeightFactor: 1.4 });
    const disclaimerY = termsStart + terms.length * 4 + 5;
    if (disclaimerY > pageHeight - 13) {
      doc.addPage();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(settings.terms_text || "", margin, 20, { maxWidth: tableWidth });
      doc.text("This is a pro forma invoice and not a VAT invoice.", margin, 36);
    } else {
      doc.text("This is a pro forma invoice and not a VAT invoice.", margin, disclaimerY);
    }

    const pageCount = doc.internal.getNumberOfPages();
    if (pageCount > 1) {
      for (let page = 1; page <= pageCount; page += 1) {
        doc.setPage(page);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
        doc.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 9, { align: "right" });
      }
    }
    const filename = `${invoiceNumber}_${safeFilename(client)}.pdf`;
    doc.save(filename);
    return { invoiceNumber, filename, error: null };
  } catch (error) {
    return { invoiceNumber, error: `The PDF could not be generated: ${error.message}` };
  }
}
