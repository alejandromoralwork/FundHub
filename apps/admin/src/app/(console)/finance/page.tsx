import type { Metadata } from "next";
import { and, desc, gte, lt } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { expenses } from "@fundhub/db/schema";
import { FinanceView, type ExpenseRow } from "@/components/finance-view";
import { CAN, requireStaff } from "@/lib/auth";
import { getFinanceSummary } from "@/lib/finance";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireStaff(CAN.finance);
  const y = Number((await searchParams).year) || new Date().getFullYear();
  const [summary, rows] = await Promise.all([
    getFinanceSummary(y),
    db
      .select()
      .from(expenses)
      .where(and(gte(expenses.date, new Date(y, 0, 1)), lt(expenses.date, new Date(y + 1, 0, 1))))
      .orderBy(desc(expenses.date)),
  ]);
  return (
    <FinanceView
      year={y}
      summary={summary}
      expenseRows={JSON.parse(JSON.stringify(rows)) as ExpenseRow[]}
      driveUrl={process.env.NEXTCLOUD_URL ? `${process.env.NEXTCLOUD_URL.replace(/\/$/, "")}/apps/files/?dir=/Finance` : null}
    />
  );
}
