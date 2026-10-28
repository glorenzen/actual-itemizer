import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { config } from "../config";
import type { Category } from "./actual";

interface FewShotExample {
  item: string;
  category: string;
}

let cachedExamples: FewShotExample[] | null = null;

// Read at call time instead of a static import: the file lives outside the
// Next.js project root and is gitignored household data.
function getFewShotExamples(): FewShotExample[] {
  cachedExamples ??= JSON.parse(readFileSync(config.localai.examplesPath, "utf8")) as FewShotExample[];
  return cachedExamples;
}

export interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

export interface ProposedAllocation {
  itemName: string;
  categoryName: string;
  amount: number;
}

export interface CategorizationResult {
  allocations: ProposedAllocation[];
  unallocatedAmount: number;
  notes: string;
}

const client = new OpenAI({ baseURL: config.localai.baseURL, apiKey: "not-needed" });

export async function categorizeOrder(params: {
  retailer: string;
  items: OrderItem[];
  grandTotal: number;
  categories: Category[];
}): Promise<CategorizationResult> {
  const categoryList = params.categories.map((c) => `${c.groupName} > ${c.name}`).join("\n");
  const examplesText = getFewShotExamples().map((e) => `- "${e.item}" -> ${e.category}`).join("\n");

  const response = await client.chat.completions.create({
    model: config.localai.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You categorize retail order line items into a household budget's existing categories. " +
          "Only use categories from the provided list. Respond with strict JSON matching this shape: " +
          '{"allocations": [{"item_name": string, "category_name": string, "amount": number}], ' +
          '"unallocated_amount": number, "notes": string}. ' +
          "`amount` is the per-unit item price in dollars; the application multiplies it by quantity. " +
          "`unallocated_amount` should cover tax/shipping/fees not tied to a specific item. " +
          "For ambiguous everyday items, prefer this household's past choices over a generic guess, " +
          "for example:\n" +
          examplesText +
          "\nAvailable categories:\n" +
          categoryList,
      },        
      {
        role: "user",
        content: JSON.stringify({
          retailer: params.retailer,
          grand_total: params.grandTotal / 100,
          items: params.items,
        }),
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as {
    allocations?: Array<{ item_name: string; category_name: string; amount: number }>;
    unallocated_amount?: number;
    notes?: string;
  };

  return {
    allocations: (parsed.allocations ?? []).map((a) => ({
      itemName: a.item_name,
      categoryName: a.category_name,
      amount: a.amount,
    })),
    unallocatedAmount: parsed.unallocated_amount ?? 0,
    notes: parsed.notes ?? "",
  };
}
