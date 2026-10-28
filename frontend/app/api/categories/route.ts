import { getAvailableCategories, initActual } from "../../lib/actual";
import { isAuthorized, unauthorized } from "../../lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();

  await initActual();
  return Response.json(await getAvailableCategories());
}
