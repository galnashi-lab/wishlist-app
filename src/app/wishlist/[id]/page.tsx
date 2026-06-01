import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import AddItemForm from "@/components/AddItemForm";
import WishlistBoard from "@/components/WishlistBoard";
import RefreshAllButton from "@/components/RefreshAllButton";
import SharePanel from "@/components/SharePanel";
import { Category } from "@prisma/client";

const CATEGORY_LABELS: Record<Category, string> = {
  MUST_HAVE: "🔥 Must Have",
  NICE_TO_HAVE: "✨ Nice to Have",
  DREAM_ITEM: "💭 Dream Item",
};

export default async function WishlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const wishlist = await prisma.wishlist.findUnique({
    where: { id },
    include: {
      items: { orderBy: { rank: "asc" } },
      owner: { select: { name: true } },
      shares: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!wishlist) notFound();

  // Access control: owner or invited email
  const isOwner = wishlist.ownerId === session.user.id;
  const isShared = wishlist.shares.some(
    (s) => s.email === session.user?.email?.toLowerCase()
  );
  if (!isOwner && !isShared) notFound();

  const grouped = {
    MUST_HAVE: wishlist.items.filter((i) => i.category === "MUST_HAVE"),
    NICE_TO_HAVE: wishlist.items.filter((i) => i.category === "NICE_TO_HAVE"),
    DREAM_ITEM: wishlist.items.filter((i) => i.category === "DREAM_ITEM"),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-600 text-sm">
              ← Dashboard
            </Link>
            <span className="text-gray-300">|</span>
            <h1 className="text-xl font-bold text-gray-800">{wishlist.name}</h1>
            <span className="text-sm text-gray-400">by {wishlist.owner.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <RefreshAllButton wishlistId={wishlist.id} />
            <SharePanel
              wishlistId={wishlist.id}
              shares={wishlist.shares}
              isOwner={isOwner}
            />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <AddItemForm wishlistId={wishlist.id} />
        <WishlistBoard
          wishlistId={wishlist.id}
          grouped={grouped}
          categoryLabels={CATEGORY_LABELS}
        />
      </main>
    </div>
  );
}
