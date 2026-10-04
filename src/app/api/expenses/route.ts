import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/server/db";
import { Expense, EXPENSE_CATEGORIES } from "@/lib/server/models/Expense";
import { Branch } from "@/lib/server/models/Branch";
import { getAuth, resolveBranchScope } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/expenses?branchId=&from=&to=
// SUPER_ADMIN sees all (optionally filtered by branch); everyone else is
// hard-scoped to their own branch regardless of query params.
export async function GET(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const url = new URL(req.url);
  const scopeBranch = resolveBranchScope(auth, url.searchParams.get("branchId"));

  const filter: Record<string, unknown> = { businessId: auth.businessId };
  if (scopeBranch) filter.branchId = scopeBranch;

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.$gte = new Date(from);
    if (to) createdAt.$lte = new Date(to);
    filter.createdAt = createdAt;
  }

  const expenses = await Expense.find(filter)
    .populate("branchId", "branchName")
    .populate("recordedBy", "name")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return NextResponse.json({ expenses });
}

const createSchema = z.object({
  branchId: z.string().trim().min(1).optional(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.number().positive().max(100_000_000),
  description: z.string().trim().min(1).max(300),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
});

// POST /api/expenses — any authenticated staff can record an expense, but
// only against a branch they are allowed to touch.
export async function POST(req: NextRequest) {
  await connectDb();
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Resolve the branch this expense is booked against, then enforce scope.
  let branchId: string | null;
  if (auth.role === "SUPER_ADMIN") {
    branchId = parsed.data.branchId ?? null;
    if (!branchId) {
      return NextResponse.json({ error: "branchId is required" }, { status: 400 });
    }
  } else {
    branchId = auth.branchId;
    // A scoped user may not book an expense onto another branch.
    if (parsed.data.branchId && parsed.data.branchId !== auth.branchId) {
      return NextResponse.json({ error: "Cannot record for another branch" }, { status: 403 });
    }
  }

  // The target branch MUST belong to this tenant.
  const branch = await Branch.findOne({ _id: branchId, businessId: auth.businessId }).lean();
  if (!branch) {
    return NextResponse.json({ error: "Branch not found in your business" }, { status: 404 });
  }

  const expense = await Expense.create({
    businessId: auth.businessId,
    branchId,
    category: parsed.data.category,
    amount: parsed.data.amount,
    description: parsed.data.description,
    reference: parsed.data.reference ?? null,
    notes: parsed.data.notes ?? null,
    recordedBy: auth.sub,
  });

  return NextResponse.json({ expense }, { status: 201 });
}
