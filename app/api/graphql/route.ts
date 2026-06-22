import { NextRequest, NextResponse } from "next/server";
import { graphql } from "graphql";
import { buildSchema, getSchemaVersion } from "@/lib/graphql/schema";
import { analyzeComplexity } from "@/lib/graphql/complexity";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { query, variables, operationName } = body;

    if (!query) {
      return NextResponse.json(
        { errors: [{ message: "Must provide a query parameter." }] },
        { status: 400 }
      );
    }

    // 1. Analyze query complexity to prevent resource exhaustion attacks
    const maxComplexity = 150; // configure as needed
    const complexityResult = analyzeComplexity(query, variables || {}, maxComplexity);

    if (complexityResult.error) {
      return NextResponse.json(
        {
          errors: [{ message: complexityResult.error }],
          extensions: {
            complexity: complexityResult.complexity,
            maxComplexity,
          },
        },
        { status: 400 }
      );
    }

    // 2. Build the dynamic schema (cached and auto-mutated based on Translation Registry)
    const schema = buildSchema();

    // 3. Execute the GraphQL operation
    const result = await graphql({
      schema,
      source: query,
      variableValues: variables,
      operationName,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("GraphQL execution error:", error);
    return NextResponse.json(
      {
        errors: [
          {
            message: error instanceof Error ? error.message : "Internal Server Error",
          },
        ],
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Simple diagnostic/info endpoint for developers visiting via browser GET
  const schema = buildSchema();
  const registeredContracts = schema.getQueryType()?.getFields().getRegisteredContracts;

  return NextResponse.json({
    status: "active",
    service: "Open-Audit Dynamic GraphQL Server",
    schemaVersion: getSchemaVersion(),
    endpoints: {
      POST: "/api/graphql",
    },
    info: "Submit a POST request with GraphQL JSON body to query dynamic translation registry data.",
  });
}
