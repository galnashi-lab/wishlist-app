"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shareWishlist, removeShare } from "@/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Share = { id: string; email: string };

export default function SharePanel({
  wishlistId,
  shares,
  isOwner,
}: {
  wishlistId: string;
  shares: Share[];
  isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const router = useRouter();

  async function handleShare() {
    if (!email.trim()) return;
    setPending(true);
    setError(null);
    try {
      await shareWishlist(wishlistId, email.trim());
      setEmail("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to share");
    } finally {
      setPending(false);
    }
  }

  async function handleRemove(shareEmail: string) {
    setRemoving(shareEmail);
    await removeShare(wishlistId, shareEmail);
    router.refresh();
    setRemoving(null);
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)} className="text-xs gap-1">
        👥 Share{shares.length > 0 ? ` (${shares.length})` : ""}
      </Button>

      {open && (
        <div className="absolute right-0 top-9 z-50 bg-white border border-gray-200 rounded-xl shadow-lg p-4 w-72">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Shared with</h3>

          {shares.length === 0 && (
            <p className="text-xs text-gray-400 mb-3">Not shared with anyone yet.</p>
          )}

          <ul className="space-y-2 mb-4">
            {shares.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-600 truncate">{s.email}</span>
                {isOwner && (
                  <button
                    onClick={() => handleRemove(s.email)}
                    disabled={removing === s.email}
                    className="text-xs text-red-400 hover:text-red-600 shrink-0"
                  >
                    {removing === s.email ? "…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {isOwner && (
            <>
              <div className="flex gap-2">
                <Input
                  placeholder="Email address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleShare()}
                  className="text-xs h-8"
                />
                <Button size="sm" onClick={handleShare} disabled={pending || !email.trim()} className="h-8 text-xs">
                  {pending ? "…" : "Add"}
                </Button>
              </div>
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
