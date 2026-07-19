import { NextResponse } from "next/server";
import { getRegistryMetadata } from "@/lib/translator/registry";
import type { ContractRegistryMetadata } from "@/lib/translator/registry";

export interface ContractsListResponse {
  contracts: ContractRegistryMetadata[];
  total: number;
}

export async function GET(): Promise<NextResponse<ContractsListResponse>> {
  const metadata = getRegistryMetadata();

  return NextResponse.json({
    contracts: metadata,
    total: metadata.length,
  });
}
