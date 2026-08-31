import { NextResponse } from "next/server";
import { generateApiKey } from "@/lib/auth/apiKey";

export async function POST(): Promise<NextResponse> {
  const { key: raw, hash: hashed } = await generateApiKey();

  return NextResponse.json({
    key: raw,
    hashed,
    note: "Store the hashed value in OA_API_KEYS. The raw key is shown once — save it now.",
  });
}
