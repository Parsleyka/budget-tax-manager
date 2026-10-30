import "server-only";
import { randomUUID } from "node:crypto";
import { nowIso } from "@/lib/dates";
import { canArchiveCategory, canDeleteCategory, checkCategoryName } from "@/lib/integrity";
import { CategoryInputSchema } from "@/lib/schemas";
import type { ActionResult, Category } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { categoriesRepo, expensesRepo } from "../db/repositories";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

export function createCategory(input: unknown): Promise<ActionResult<Category>> {
  return guard(async () => {
    const parsed = CategoryInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const c = parsed.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const problem = checkCategoryName(c.name, await categoriesRepo.list());
      if (problem) return fromProblem(problem);
      const now = nowIso();
      const category: Category = {
        id: randomUUID(),
        name: c.name,
        color: c.color,
        ...(c.icon ? { icon: c.icon } : {}),
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      return ok(await categoriesRepo.insert(category));
    });
  });
}

/** Rename / recolor / change icon. The Taxes category keeps its systemKey. */
export function updateCategory(id: unknown, input: unknown): Promise<ActionResult<Category>> {
  return guard(async () => {
    const categoryId = parseId(id);
    if (isFailure(categoryId)) return categoryId;
    const parsed = CategoryInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const c = parsed.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const categories = await categoriesRepo.list();
      if (!categories.some((x) => x.id === categoryId)) return fail("Category not found");
      const problem = checkCategoryName(c.name, categories, categoryId);
      if (problem) return fromProblem(problem);
      return ok(
        await categoriesRepo.update(categoryId, (existing) => {
          const { icon: _oldIcon, ...rest } = existing;
          void _oldIcon;
          return { ...rest, name: c.name, color: c.color, ...(c.icon ? { icon: c.icon } : {}), updatedAt: nowIso() };
        }),
      );
    });
  });
}

export function archiveCategory(id: unknown, archived: unknown = true): Promise<ActionResult<Category>> {
  return guard(async () => {
    const categoryId = parseId(id);
    if (isFailure(categoryId)) return categoryId;
    if (typeof archived !== "boolean") return fail("Invalid archived flag");
    return withLock(DB_WRITE_LOCK, async () => {
      if (archived) {
        const problem = canArchiveCategory(categoryId, { categories: await categoriesRepo.list() });
        if (problem) return fromProblem(problem);
      }
      return ok(await categoriesRepo.update(categoryId, (c) => ({ ...c, archived, updatedAt: nowIso() })));
    });
  });
}

/** Pin (shown first in every category list) or unpin. An archived category keeps its pin for when it is restored. */
export function pinCategory(id: unknown, pinned: unknown = true): Promise<ActionResult<Category>> {
  return guard(async () => {
    const categoryId = parseId(id);
    if (isFailure(categoryId)) return categoryId;
    if (typeof pinned !== "boolean") return fail("Invalid pinned flag");
    return withLock(DB_WRITE_LOCK, async () => {
      const category = (await categoriesRepo.list()).find((c) => c.id === categoryId);
      if (!category) return fail("Category not found");
      if (pinned && category.archived) return fail(`“${category.name}” is archived — restore it to pin it.`);
      return ok(
        await categoriesRepo.update(categoryId, (c) => {
          const { pinned: _old, ...rest } = c;
          void _old;
          return { ...rest, ...(pinned ? { pinned: true } : {}), updatedAt: nowIso() };
        }),
      );
    });
  });
}

export function deleteCategory(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const categoryId = parseId(id);
    if (isFailure(categoryId)) return categoryId;
    return withLock(DB_WRITE_LOCK, async () => {
      const [categories, expenses] = await Promise.all([categoriesRepo.list(), expensesRepo.list()]);
      const problem = canDeleteCategory(categoryId, { categories, expenses });
      if (problem) return fromProblem(problem);
      await categoriesRepo.remove(categoryId);
      return ok(null);
    });
  });
}
