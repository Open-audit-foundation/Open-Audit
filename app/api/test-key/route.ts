import { NextRequest, NextResponse } from "next/server";
import { generateApiKey } from "@/lib/auth/apiKey";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { key, hash } = await generateApiKey();
  return NextResponse.json({ apiKey: key, hash });
}
