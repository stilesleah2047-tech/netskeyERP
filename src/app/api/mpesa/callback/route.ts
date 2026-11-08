import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/server/db";
import { Transaction } from "@/lib/server/models/Transaction";
import { MpesaCallbackLog } from "@/lib/server/models/MpesaCallbackLog";
import { recordOutbound } from "@/lib/server/stock";
import { checkCallbackAuth } from "@/lib/server/mpesaGuard";

export const runtime = "nodejs";

function getSourceIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}


export async function POST(req: NextRequest) {
  await connectDb();
  const ack = () => NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  const sourceIp = getSourceIp(req);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    await MpesaCallbackLog.create({
      sourceIp,
      rawPayload: { unparsable: true },
      processingNote: "Malformed JSON body",
    });
    return ack();
  }

  const callback = payload?.Body?.stkCallback;
  const checkoutRequestId: string | undefined = callback?.CheckoutRequestID;
  const resultCode: number | undefined = callback?.ResultCode;
  const resultDesc: string = callback?.ResultDesc ?? "";

  const authProblem = checkCallbackAuth(sourceIp, req.nextUrl.searchParams.get("s"));
  if (authProblem) {
    await MpesaCallbackLog.create({
      sourceIp,
      checkoutRequestId: checkoutRequestId ?? null,
      resultCode: resultCode ?? null,
      rawPayload: payload,
      processingNote: "Rejected: " + authProblem,
    });
    return ack();
  }

  if (!checkoutRequestId) {
    await MpesaCallbackLog.create({
      sourceIp,
      rawPayload: payload ?? {},
      processingNote: "No CheckoutRequestID in payload",
    });
    return ack();
  }

  let mpesaReceiptNumber: string | null = null;
  let amountPaid: number | null = null;
  if (resultCode === 0 && callback.CallbackMetadata?.Item) {
    const items: { Name: string; Value: string | number }[] = callback.CallbackMetadata.Item;
    const receiptItem = items.find((i: any) => i.Name === "MpesaReceiptNumber");
    mpesaReceiptNumber = receiptItem ? String(receiptItem.Value) : null;
    const amountItem = items.find((i: any) => i.Name === "Amount");
    amountPaid = amountItem != null ? Number(amountItem.Value) : null;
  }

  const txn = await Transaction.findOne({ "mpesaDetails.checkoutRequestId": checkoutRequestId });

  if (!txn) {
    await MpesaCallbackLog.create({
      sourceIp,
      checkoutRequestId,
      resultCode: resultCode ?? null,
      rawPayload: payload,
      processingNote: "No matching transaction for CheckoutRequestID",
    });
    return ack();
  }

  if (txn.paymentStatus !== "PENDING") {
    await MpesaCallbackLog.create({
      sourceIp,
      checkoutRequestId,
      resultCode: resultCode ?? null,
      matchedTransactionId: txn._id,
      rawPayload: payload,
      processingNote: "Ignored: transaction already " + txn.paymentStatus,
    });
    return ack();
  }

  // A success is only accepted if the amount paid matches the sale (Daraja
  // charges whole shillings, so compare against the rounded total).
  const expected = Math.round(txn.amountTotal);
  const amountOk = amountPaid !== null && Math.round(amountPaid) === expected;
  const newStatus = resultCode === 0 && amountOk ? "SUCCESS" : "FAILED";
  txn.paymentStatus = newStatus;
  txn.mpesaDetails.resultCode = resultCode ?? null;
  txn.mpesaDetails.resultDesc =
    resultCode === 0 && !amountOk
      ? `Amount mismatch: paid ${amountPaid ?? "unknown"}, expected ${expected}. Needs review.`
      : resultDesc;
  txn.mpesaDetails.receiptNumber = mpesaReceiptNumber;
  await txn.save();

  // Only a SUCCESSFUL M-Pesa payment represents real stock leaving the
  // branch. We deduct here (not at STK-push time) so abandoned/failed
  // prompts never touch stock. Guarded so a ledger error can't flip an
  // already-paid sale back to unpaid.
  if (newStatus === "SUCCESS") {
    try {
      await recordOutbound({
        businessId: txn.businessId,
        branchId: txn.branchId,
        productId: txn.productId,
        type: "SALE",
        quantity: txn.quantity,
        allowNegative: true,
        relatedType: "TRANSACTION",
        relatedId: txn._id,
        createdBy: txn.staffId,
      });
    } catch {
      // Non-fatal; backfill:stock can repair any ledger gap later.
    }
  }

  await MpesaCallbackLog.create({
    sourceIp,
    checkoutRequestId,
    resultCode: resultCode ?? null,
    matchedTransactionId: txn._id,
    rawPayload: payload,
    processingNote: "Applied: transaction set to " + newStatus,
  });

  return ack();
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
