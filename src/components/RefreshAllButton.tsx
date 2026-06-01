"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { refreshAllItems } from "@/actions/wishlist";
import { Button } from "@/components/ui/button";

export default function RefreshAllButton({ wishlistId }: { wishlistId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [result, setResult] = useState<{ total: number; updated: number } | null>(null);
  const router = useRouter();

  async function handleRefreshAll() {
    setStatus("loading");
    setResult(null);
    const res = await refreshAllItems(wishlistId);
    setResult(res);
    setStatus("done");
    if (res.updated > 0) router.refresh();
    setTimeout(() => setStatus("idle"), 3000);
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRefreshAll}
      disabled={status === "loading"}
      className="text-xs gap-1"
    >
      {status === "loading" && "↻ Refreshing…"}
      {status === "done" && result && (
        result.updated > 0
          ? `✓ Updated ${result.updated}/${result.total}`
          : `– No changes (${result.total} checked)`
      )}
      {status === "idle" && "↻ Refresh All Prices"}
    </Button>
  );
}
