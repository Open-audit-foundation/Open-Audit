import { NextRequest, NextResponse } from "next/server";
import { generateApiKey } from "@/lib/api/apiKeys";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { key, hash } = generateApiKey();
  return NextResponse.json({ apiKey: key, hash });
}
