import { Router } from "express";
import { getAvailableCategories } from "../actual.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", async (_req, res) => {
  res.json(await getAvailableCategories());
});
