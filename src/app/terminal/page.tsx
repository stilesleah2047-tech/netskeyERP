"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { isValidKenyanPhone } from "@/lib/phone";
import { AuthUser, PaymentMethod, Product } from "@/lib/types";
import {
  generateClientUuid,
  queueCashSale,
  registerOfflineSync,
  applySyncResult,
  toWire,
  countPending,
  getRejectedSales,
  dismissRejected,
  QueuedCashSale,
  SyncResponse,
} from "@/lib/offlineQueue";

// Cached copies of the signed-in user and price list, so the terminal can
// open and sell with no connection (PRD 5.5 "Sale works fully offline").
const ME_CACHE_KEY = "aquaflow:terminal:me";
const PRODUCTS_CACHE_KEY = "aquaflow:terminal:products";

function readCache<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeCache(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: offline open just won't work */
  }
}
import { useToast } from "@/components/ui/Toast";
import ProductSizeSelector from "@/components/terminal/ProductSizeSelector";
import QuantityCounter from "@/components/terminal/QuantityCounter";
import PaymentMethodToggle from "@/components/terminal/PaymentMethodToggle";
import PaymentStatusOverlay, { MpesaUiState } from "@/components/terminal/PaymentStatusOverlay";

interface BasketLine {
  productId: string;
  label: string;
  unitPrice: number;
  quantity: number;
}

interface CashReceipt {
  receiptNo: string;
  lines: BasketLine[];
  total: number;
  at: string;
  customerName?: string;
}

// Short, human-readable receipt number: date plus 4 characters of the sale's
// group id. Unique enough to find a sale on the owner's side; the group id
// itself is the real key.
function makeReceiptNo(groupId: string, at: Date) {
  const d = at.toISOString().slice(2, 10).replace(/-/g, "");
  return d + "-" + groupId.replace(/-/g, "").slice(0, 4).toUpperCase();
}

function lineLabel(p: Product) {
  return p.label || p.sizeLiters + (p.unit && p.unit !== "L" ? " " + p.unit : "L");
}

type ScreenState =
  | { kind: "idle" }
  | { kind: "cash_saved"; receipt: CashReceipt }
  | { kind: "mpesa"; transactionId: string; ui: MpesaUiState; receipt?: string | null; reason?: string | null };

export default function TerminalPage() {
  const router = useRouter();
  const { show } = useToast();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [rejectedSales, setRejectedSales] = useState<QueuedCashSale[]>([]);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [screen, setScreen] = useState<ScreenState>({ kind: "idle" });
  // Several sizes in one sale (PRD 5.3). Empty basket = quick single-item sale.
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedProduct = products.find((p) => p._id === selectedProductId) ?? null;
  const amount = selectedProduct ? quantity * selectedProduct.unitPrice : 0;
  const basketTotal = basket.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  // What the pay button charges: the basket if it has lines, otherwise the
  // current selection on its own.
  const chargeTotal = basket.length > 0 ? basketTotal : amount;

  function addToBasket() {
    if (!selectedProduct) {
      setFormError("Choose a jerrycan size first.");
      return;
    }
    setFormError(null);
    setBasket((prev) => {
      const existing = prev.find((l) => l.productId === selectedProduct._id);
      if (existing) {
        return prev.map((l) =>
          l.productId === selectedProduct._id ? { ...l, quantity: Math.min(500, l.quantity + quantity) } : l
        );
      }
      return [
        ...prev,
        { productId: selectedProduct._id, label: lineLabel(selectedProduct), unitPrice: selectedProduct.unitPrice, quantity },
      ];
    });
    setQuantity(1);
  }

  function removeFromBasket(productId: string) {
    setBasket((prev) => prev.filter((l) => l.productId !== productId));
  }

  async function refreshQueueState(userId: string) {
    try {
      setPendingCount(await countPending(userId));
      setRejectedSales(await getRejectedSales(userId));
    } catch {
      /* IndexedDB unavailable */
    }
  }

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    let unregister: () => void = () => {};

    (async () => {
      let user: AuthUser | null = null;
      try {
        const result = await apiFetch<{ user: AuthUser }>("/api/auth/me");
        user = result.user;
        writeCache(ME_CACHE_KEY, user);
      } catch (err) {
        // Offline (network error, not a 401): fall back to the last signed-in
        // user on this device so the cashier can keep selling.
        const isAuthFailure = err instanceof ApiError && (err.status === 401 || err.status === 403);
        const cached = !isAuthFailure ? readCache<AuthUser>(ME_CACHE_KEY) : null;
        if (!cached) {
          router.replace("/login");
          return;
        }
        user = cached;
      }
      if (user.role === "SUPER_ADMIN") {
        router.replace("/admin/dashboard");
        return;
      }
      setMe(user);
      setAuthChecked(true);
      const userId = user.id;
      refreshQueueState(userId);

      unregister = registerOfflineSync(userId, (r) => {
        if (r.synced > 0) show(r.synced + " queued sale(s) synced", "success");
        if (r.rejected > 0) show(r.rejected + " queued sale(s) were rejected — see below", "error");
        refreshQueueState(userId);
      });

      try {
        // pricing=branch applies this branch's price overrides, so the screen
        // shows the same price the server will record.
        const productsResult = await apiFetch<{ products: Product[] }>("/api/products?pricing=branch");
        setProducts(productsResult.products);
        writeCache(PRODUCTS_CACHE_KEY, productsResult.products);
        if (productsResult.products.length > 0) setSelectedProductId(productsResult.products[0]._id);
      } catch {
        const cached = readCache<Product[]>(PRODUCTS_CACHE_KEY);
        if (cached && cached.length > 0) {
          setProducts(cached);
          setSelectedProductId(cached[0]._id);
          show("Offline — using the last saved price list", "info");
        } else {
          show("Could not load jerrycan sizes — check your connection", "error");
        }
      }
      setProductsLoading(false);
    })();

    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      show("Back online — syncing queued sales", "info");
    };
    const goOffline = () => {
      setOnline(false);
      show("You're offline — cash sales will keep saving and sync automatically", "info");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      unregister();
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setCustomerName("");
    setCustomerPhone("");
    setQuantity(1);
    setBasket([]);
    setMethod("CASH");
    setPhoneError(null);
    setFormError(null);
    setScreen({ kind: "idle" });
  }

  function validate(): boolean {
    if (!selectedProduct && !(method === "CASH" && basket.length > 0)) {
      setFormError("Choose a jerrycan size first.");
      return false;
    }
    // Phone is required for M-Pesa (the prompt goes to it) but optional for a
    // walk-in cash sale, to keep the counter fast.
    const phoneNeeded = method === "MPESA" || customerPhone.trim() !== "";
    if (phoneNeeded && !isValidKenyanPhone(customerPhone)) {
      setPhoneError("Enter a valid Kenyan number: 07XXXXXXXX or +2547XXXXXXXX");
      return false;
    }
    setPhoneError(null);
    setFormError(null);
    return true;
  }

  async function handleCashSale() {
    if (!validate() || !me) return;
    const lines: BasketLine[] =
      basket.length > 0
        ? basket
        : selectedProduct
          ? [{ productId: selectedProduct._id, label: lineLabel(selectedProduct), unitPrice: selectedProduct.unitPrice, quantity }]
          : [];
    if (lines.length === 0) return;
    setSubmitting(true);

    const now = new Date();
    const saleGroupId = generateClientUuid();
    const receiptNo = makeReceiptNo(saleGroupId, now);
    // One queued row per line, each with its own idempotency key, so a line
    // is never recorded twice and each draws its own stock.
    const rows: Omit<QueuedCashSale, "status">[] = lines.map((l) => ({
      clientUuid: generateClientUuid(),
      customerName: customerName || undefined,
      customerPhone: customerPhone.trim() || undefined,
      productId: l.productId,
      quantity: l.quantity,
      clientSubmittedAt: now.toISOString(),
      clientUnitPrice: l.unitPrice,
      userId: me.id,
      branchId: me.branchId,
      saleGroupId,
      receiptNo,
    }));

    // IndexedDB write is the only step that must complete before we can
    // safely show success — it guarantees the sale survives a crash or power
    // loss before the network sync below finishes.
    for (const row of rows) await queueCashSale(row);
    setPendingCount((c) => c + rows.length);
    setSubmitting(false);

    // OPTIMISTIC UI: confirm immediately with a receipt built on the device,
    // so it works offline too. Sync happens in the background.
    setScreen({
      kind: "cash_saved",
      receipt: {
        receiptNo,
        lines,
        total: lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
        at: now.toISOString(),
        customerName: customerName || undefined,
      },
    });

    if (navigator.onLine) {
      apiFetch<SyncResponse>("/api/transactions/cash", {
        method: "POST",
        body: JSON.stringify({ sales: rows.map((r) => toWire({ ...r, status: "pending" })) }),
      })
        // Mark the rows synced (or rejected) in IndexedDB so the background
        // flush never re-sends them.
        .then((result) => applySyncResult(result))
        .then(() => refreshQueueState(me.id))
        .catch(() => {
          // stays queued; the offline sync interval will retry
        });
    }
  }

  function receiptText(r: CashReceipt) {
    const lines = r.lines.map((l) => `${l.quantity} x ${l.label} @ KES ${l.unitPrice.toLocaleString()} = KES ${(l.quantity * l.unitPrice).toLocaleString()}`);
    return [
      me?.businessName || "Receipt",
      me?.branchName ? "Branch: " + me.branchName : "",
      "Receipt " + r.receiptNo,
      new Date(r.at).toLocaleString(),
      r.customerName ? "Customer: " + r.customerName : "",
      "",
      ...lines,
      "",
      "Total (cash): KES " + r.total.toLocaleString(),
      "Served by " + (me?.name ?? ""),
    ]
      .filter((x, i, arr) => x !== "" || (i > 0 && arr[i - 1] !== ""))
      .join("\n");
  }

  async function shareReceipt(r: CashReceipt) {
    const text = receiptText(r);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Receipt " + r.receiptNo, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      show("Receipt copied — paste it into SMS or WhatsApp", "success");
    } catch {
      /* user cancelled the share sheet */
    }
  }

  async function startMpesaPush() {
    if (!validate() || !selectedProduct) return;
    if (basket.length > 0) {
      setFormError("M-Pesa takes one size per payment for now. Record this basket as cash, or clear it to pay one size by M-Pesa.");
      return;
    }
    if (!navigator.onLine) {
      setFormError("M-Pesa requires an active network connection.");
      return;
    }
    setSubmitting(true);

    try {
      const data = await apiFetch<{ transactionId: string }>("/api/mpesa/stkpush", {
        method: "POST",
        body: JSON.stringify({
          customerName: customerName || undefined,
          customerPhone,
          productId: selectedProduct._id,
          quantity,
        }),
      });
      setScreen({ kind: "mpesa", transactionId: data.transactionId, ui: "AWAITING_PIN" });
      beginPolling(data.transactionId);
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : "Network error while contacting M-Pesa.";
      setScreen({ kind: "mpesa", transactionId: "", ui: "FAILED", reason });
    }
    setSubmitting(false);
  }

  function beginPolling(transactionId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const start = Date.now();

    pollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch<any>("/api/mpesa/status/" + transactionId);
        if (data.paymentStatus === "SUCCESS") {
          clearInterval(pollRef.current!);
          setScreen({ kind: "mpesa", transactionId, ui: "SUCCESS", receipt: data.mpesaDetails?.receiptNumber });
        } else if (data.paymentStatus === "FAILED") {
          clearInterval(pollRef.current!);
          setScreen({
            kind: "mpesa",
            transactionId,
            ui: "FAILED",
            reason: data.mpesaDetails?.resultDesc || "Payment was not completed.",
          });
        } else if (Date.now() - start > 60000) {
          clearInterval(pollRef.current!);
          setScreen({ kind: "mpesa", transactionId, ui: "FAILED", reason: "No confirmation yet. Do NOT take cash for this sale — the customer may still complete the M-Pesa payment. Check the live feed first." });
        }
      } catch {
        // transient network hiccup while polling; keep trying until timeout above
      }
    }, 3000);
  }

  if (!authChecked || !me) {
    return (
      <main className="min-h-screen bg-sand-50 pb-10">
        <header className="bg-depth-900 px-5 pb-6 pt-8">
          <div className="h-12 w-40 animate-pulse rounded-lg bg-white/10" />
        </header>
        <div className="mx-auto -mt-3 max-w-md space-y-4 px-5">
          <div className="h-40 animate-pulse rounded-xl2 bg-white shadow-soft" />
          <div className="h-24 animate-pulse rounded-xl2 bg-white shadow-soft" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-sand-50 pb-10">
      <header className="bg-depth-900 px-5 pb-6 pt-8 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-flow-400">{me.branchName || "Branch"}</p>
            <h1 className="font-display text-lg font-bold">{me.name}</h1>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + (online ? "bg-confirm-500/20 text-confirm-500" : "bg-alert-500/20 text-alert-500")}>
              {online ? "● Online" : "● Offline"}
            </span>
            {pendingCount > 0 && <span className="text-xs text-cash-400">{pendingCount} cash sale(s) syncing…</span>}
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 max-w-md space-y-4 px-5">
        {rejectedSales.length > 0 && (
          <div className="rounded-xl2 border border-alert-500/40 bg-white p-4 shadow-soft">
            <h2 className="font-display text-sm font-bold text-alert-500">
              {rejectedSales.length} queued sale(s) could not be saved
            </h2>
            <p className="mt-1 text-xs text-depth-600">
              These were recorded on this device but the server refused them. Tell your manager, then dismiss.
            </p>
            <ul className="mt-3 space-y-2">
              {rejectedSales.map((r) => (
                <li key={r.clientUuid} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-depth-700">
                    {new Date(r.clientSubmittedAt).toLocaleString()} · qty {r.quantity}
                    {r.clientUnitPrice != null ? " · KES " + (r.clientUnitPrice * r.quantity).toLocaleString() : ""}
                    <br />
                    <span className="text-xs text-alert-500">{r.rejectReason || "Rejected"}</span>
                  </span>
                  <button
                    onClick={async () => {
                      await dismissRejected(r.clientUuid);
                      if (me) refreshQueueState(me.id);
                    }}
                    className="rounded-lg border border-depth-200 px-2 py-1 text-xs text-depth-600"
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {screen.kind === "cash_saved" ? (
          <div className="animate-fade-up rounded-xl2 border border-cash-500/30 bg-white p-6 shadow-soft print:border-0 print:shadow-none">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-cash-500/15 text-2xl print:hidden">💵</div>
              <h2 className="font-display text-lg font-bold text-depth-900">Cash sale recorded</h2>
              <p className="mt-1 text-sm text-depth-600">
                Receipt {screen.receipt.receiptNo} · {new Date(screen.receipt.at).toLocaleString()}
              </p>
              {screen.receipt.customerName && <p className="text-sm text-depth-600">{screen.receipt.customerName}</p>}
            </div>
            <table className="mt-4 w-full text-sm">
              <tbody>
                {screen.receipt.lines.map((l) => (
                  <tr key={l.productId} className="border-b border-depth-200/60">
                    <td className="py-2 text-depth-800">
                      {l.quantity} × {l.label}
                      <span className="block text-xs text-depth-600">KES {l.unitPrice.toLocaleString()} each</span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-depth-900">KES {(l.quantity * l.unitPrice).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 font-display font-bold text-depth-900">Total</td>
                  <td className="pt-3 text-right font-display font-bold tabular-nums text-depth-900">
                    KES {screen.receipt.total.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-6 grid grid-cols-2 gap-3 print:hidden">
              <button
                onClick={() => shareReceipt(screen.receipt)}
                className="tap-target rounded-xl2 border border-depth-200 font-display font-semibold text-depth-800"
              >
                Share receipt
              </button>
              <button
                onClick={() => window.print()}
                className="tap-target rounded-xl2 border border-depth-200 font-display font-semibold text-depth-800"
              >
                Print
              </button>
            </div>
            <button onClick={resetForm} className="tap-target mt-3 w-full rounded-xl2 bg-flow-500 font-display font-semibold text-depth-950 active:scale-[0.98] print:hidden">
              Start next sale
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-xl2 border border-depth-200/60 bg-white p-4 shadow-soft">
              <label className="mb-1.5 block text-sm font-medium text-depth-600" htmlFor="cust-name">
                Customer name (optional)
              </label>
              <input
                id="cust-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Jane Wambui"
                className="tap-target w-full rounded-xl border border-depth-200 px-3 mb-3"
              />
              <label className="mb-1.5 block text-sm font-medium text-depth-600" htmlFor="cust-phone">
                Customer phone{method === "CASH" ? " (optional for cash)" : ""}
              </label>
              <input
                id="cust-phone"
                inputMode="tel"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                  if (phoneError) setPhoneError(null);
                }}
                placeholder="07XXXXXXXX"
                className={"tap-target w-full rounded-xl border px-3 " + (phoneError ? "border-alert-500" : "border-depth-200")}
              />
              {phoneError && <p className="mt-1.5 text-sm text-alert-500">{phoneError}</p>}
            </div>

            {productsLoading ? (
              <div className="h-24 animate-pulse rounded-xl2 bg-white shadow-soft" />
            ) : (
              <ProductSizeSelector products={products} selectedId={selectedProductId} onSelect={setSelectedProductId} />
            )}

            {selectedProduct && (
              <QuantityCounter quantity={quantity} onChange={setQuantity} unitPrice={selectedProduct.unitPrice} sizeLabel={selectedProduct.sizeLiters + "L"} />
            )}

            {selectedProduct && method === "CASH" && (
              <button
                type="button"
                onClick={addToBasket}
                className="tap-target w-full rounded-xl2 border border-depth-200 bg-white font-display font-semibold text-depth-800 active:scale-[0.98]"
              >
                Add {quantity} × {lineLabel(selectedProduct)} to this sale
              </button>
            )}

            {basket.length > 0 && (
              <div className="rounded-xl2 border border-depth-200/60 bg-white p-4 shadow-soft">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold text-depth-900">This sale</h2>
                  <button type="button" onClick={() => setBasket([])} className="text-xs text-depth-600 underline underline-offset-2">
                    Clear
                  </button>
                </div>
                <ul className="space-y-2">
                  {basket.map((l) => (
                    <li key={l.productId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-depth-800">
                        {l.quantity} × {l.label}
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular-nums text-depth-900">KES {(l.quantity * l.unitPrice).toLocaleString()}</span>
                        <button
                          type="button"
                          onClick={() => removeFromBasket(l.productId)}
                          aria-label={"Remove " + l.label}
                          className="rounded-lg border border-depth-200 px-2 py-1 text-xs text-depth-600"
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {formError && <p className="text-sm text-alert-500">{formError}</p>}

            <div className="space-y-3">
              <PaymentMethodToggle value={method} onChange={setMethod} />

              {method === "CASH" ? (
                <button
                  onClick={handleCashSale}
                  disabled={submitting || (!selectedProduct && basket.length === 0)}
                  className="tap-target w-full rounded-xl2 bg-cash-500 font-display text-lg font-bold text-white shadow-soft transition active:scale-[0.98] disabled:opacity-60"
                >
                  {submitting ? "Saving…" : "Record cash sale · KES " + chargeTotal.toLocaleString()}
                </button>
              ) : (
                <button
                  onClick={startMpesaPush}
                  disabled={submitting || !selectedProduct}
                  className="tap-target w-full rounded-xl2 bg-confirm-500 font-display text-lg font-bold text-white shadow-soft transition active:scale-[0.98] disabled:opacity-60"
                >
                  {submitting ? "Sending prompt…" : "Initiate Payment · KES " + amount.toLocaleString()}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {screen.kind === "mpesa" && (
        <PaymentStatusOverlay
          state={screen.ui}
          amount={amount}
          receiptNumber={screen.receipt}
          failureReason={screen.reason}
          onRetry={() => {
            setScreen({ kind: "idle" });
            startMpesaPush();
          }}
          onNewSale={resetForm}
          onDismiss={() => setScreen({ kind: "idle" })}
        />
      )}
    </main>
  );
}
