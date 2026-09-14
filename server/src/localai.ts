import OpenAI from "openai";
import { config } from "./config.js";
import type { Category } from "./actual.js";

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

  const response = await client.chat.completions.create({
    model: config.localai.model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You categorize retail order line items into a household budget's existing categories. " +
          "Only use categories from the provided list. Respond with strict JSON matching this shape: " +
          '{"allocations": [{"item_name": string, "category_name": string, "amount": number}], ' +
          '"unallocated_amount": number, "notes": string}. ' +
          "`amount` values are in the same currency unit as given (dollars). " +
          "`unallocated_amount` should cover tax/shipping/fees not tied to a specific item. " +
          "Available categories:\n" +
          categoryList,
      },
      {
        role: "user",
        content: JSON.stringify({
          retailer: params.retailer,
          grand_total: params.grandTotal,
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
