import { DocumentNode, FieldNode, OperationDefinitionNode, parse, visit } from "graphql";

/**
 * Traverses a GraphQL query AST and calculates its complexity score.
 * List fields multiply the complexity of their subfields by their limit.
 * If the total complexity exceeds maxComplexity, an error string is returned.
 */
export function analyzeComplexity(
  query: string,
  variables: Record<string, any> = {},
  maxComplexity = 100
): { complexity: number; error?: string } {
  let document: DocumentNode;
  try {
    document = parse(query);
  } catch (err) {
    return {
      complexity: 0,
      error: err instanceof Error ? err.message : "Invalid GraphQL query",
    };
  }

  let totalComplexity = 0;

  const computeNodeComplexity = (node: FieldNode, currentDepth: number): number => {
    // Base cost for selecting a field
    let cost = 1;

    // Check if this is a field that takes a limit argument
    const limitArg = node.arguments?.find((arg) => arg.name.value === "limit");
    
    // Check if this field returns a list/connection
    const isListField =
      node.name.value === "events" ||
      node.name.value.startsWith("getTransfers") ||
      node.name.value.startsWith("getMints") ||
      node.name.value.startsWith("getBurns") ||
      node.name.value.startsWith("get");

    let limit = 1;
    if (limitArg) {
      if (limitArg.value.kind === "IntValue") {
        limit = parseInt(limitArg.value.value, 10);
      } else if (limitArg.value.kind === "Variable") {
        const varName = limitArg.value.name.value;
        if (variables && variables[varName] !== undefined) {
          limit = Number(variables[varName]);
        }
      }
    } else if (isListField) {
      // Default multiplier when limit is omitted for safety
      limit = 10;
    }

    if (node.selectionSet) {
      let subComplexity = 0;
      for (const selection of node.selectionSet.selections) {
        if (selection.kind === "Field") {
          subComplexity += computeNodeComplexity(selection, currentDepth + 1);
        }
      }
      // Sub-fields are multiplied by the limit factor
      cost += subComplexity * limit;
    }

    return cost;
  };

  visit(document, {
    OperationDefinition(node: OperationDefinitionNode) {
      for (const selection of node.selectionSet.selections) {
        if (selection.kind === "Field") {
          totalComplexity += computeNodeComplexity(selection, 0);
        }
      }
    },
  });

  if (totalComplexity > maxComplexity) {
    return {
      complexity: totalComplexity,
      error: `Query complexity of ${totalComplexity} exceeds the maximum allowed complexity of ${maxComplexity}.`,
    };
  }

  return { complexity: totalComplexity };
}
