/**
 * POST /api/developer/rotate-key
 *
 * Generates a new oa_live_* key and returns the hashed form for
 * the operator to store in OA_API_KEYS. The raw key is shown once.
 *
 * In production this would persist to a DB. Right now it demonstrates
 * the key format and hashing so operators can update their env.
 */
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { hashKey } from "@/lib/auth/apiKey";

export async function POST(): Promise<NextResponse> {
  const raw = `oa_live_${randomBytes(24).toString("hex")}`;
  const hashed = hashKey(raw);

  return NextResponse.json({
    key: raw,
    hashed,
    note: "Store the hashed value in OA_API_KEYS. The raw key is shown once — save it now.",
  });
}
