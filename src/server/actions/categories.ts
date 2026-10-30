"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Category, CategoryInput } from "@/lib/types";
import * as service from "../services/categories";

export async function createCategory(input: CategoryInput): Promise<ActionResult<Category>> {
  const result = await service.createCategory(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Rename / recolor / change icon (also allowed for the Taxes category). */
export async function updateCategory(id: string, input: CategoryInput): Promise<ActionResult<Category>> {
  const result = await service.updateCategory(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Archive (archived = true, default) or restore (false). The Taxes category cannot be archived. */
export async function archiveCategory(id: string, archived = true): Promise<ActionResult<Category>> {
  const result = await service.archiveCategory(id, archived);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Pin (pinned = true, default) or unpin: pinned categories are listed first everywhere. */
export async function pinCategory(id: string, pinned = true): Promise<ActionResult<Category>> {
  const result = await service.pinCategory(id, pinned);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Only when unused and not the Taxes category; otherwise returns { ok: false } suggesting archive. */
export async function deleteCategory(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteCategory(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
