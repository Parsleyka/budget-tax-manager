import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      className="my-8"
      icon={<Compass />}
      title="Page not found"
      description="There is nothing at this address. It may have moved, or the link is mistyped."
      action={
        <Button asChild>
          <Link href="/">Back to Overview</Link>
        </Button>
      }
    />
  );
}
