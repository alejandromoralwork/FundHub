import type { Metadata } from "next";
import { SqlConsole } from "@/components/db-views";
import { CAN, requireStaff } from "@/lib/auth";
import { runReadOnlySql } from "@/lib/sql-actions";
import { RESOURCES, tableName } from "@/lib/resources";

export const metadata: Metadata = { title: "SQL console" };

export default async function SqlPage() {
  await requireStaff(CAN.sql);
  return <SqlConsole run={runReadOnlySql} tables={Object.values(RESOURCES).map(tableName)} />;
}
