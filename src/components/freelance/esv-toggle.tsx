"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ESV_PARAM } from "./model";

/**
 * "Include ЄСВ" switch (`?esv=1`). Offered only when the saved ЄСВ mode owes nothing (an employer pays
 * it, or exempt): turning it on previews the minimum ЄСВ as an optional extra — view only, the saved
 * settings and every real due / overdue figure stay as they are.
 */
export function EsvToggle({ included }: { included: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useOptimistic(included);

  function change(next: boolean) {
    startTransition(() => {
      setOn(next);
      // Read the live URL: the month selection is mirrored into it with history.replaceState.
      const params = new URLSearchParams(window.location.search);
      if (next) params.set(ESV_PARAM, "1");
      else params.delete(ESV_PARAM);
      const qs = params.toString().replace(/%2C/gi, ",");
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="flex items-center gap-2" data-testid="esv-toggle">
      <Switch id="include-esv" size="sm" checked={on} onCheckedChange={change} />
      <Label htmlFor="include-esv" className="cursor-pointer text-sm font-normal text-muted-foreground">
        Include ЄСВ
      </Label>
      {pending ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
    </div>
  );
}
