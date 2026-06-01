import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CreateWishlistDialog from "@/components/CreateWishlistDialog";
import { signOut } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const email = session.user.email?.toLowerCase() ?? "";

  const [owned, shared] = await Promise.all([
    prisma.wishlist.findMany({
      where: { ownerId: session.user.id },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.wishlist.findMany({
      where: { shares: { some: { email } } },
      include: {
        _count: { select: { items: true } },
        owner: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎁</span>
            <h1 className="text-xl font-bold text-gray-800">WishRank</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{session.user.name}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button variant="outline" size="sm" type="submit">Sign out</Button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-10">
        {/* My Wishlists */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold text-gray-800">My Wishlists</h2>
            <CreateWishlistDialog />
          </div>
          {owned.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">✨</p>
              <p>No wishlists yet. Create your first one!</p>
            </div>
          ) : (
            <WishlistGrid wishlists={owned} />
          )}
        </section>

        {/* Shared with me */}
        {shared.length > 0 && (
          <section>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Shared with me</h2>
            <WishlistGrid
              wishlists={shared.map((wl) => ({
                ...wl,
                subtitle: `by ${(wl as typeof wl & { owner: { name: string | null } }).owner.name}`,
              }))}
            />
          </section>
        )}
      </main>
    </div>
  );
}

function WishlistGrid({
  wishlists,
}: {
  wishlists: Array<{
    id: string;
    name: string;
    createdAt: Date;
    subtitle?: string;
    _count: { items: number };
  }>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {wishlists.map((wl) => (
        <Link key={wl.id} href={`/wishlist/${wl.id}`}>
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="text-lg">{wl.name}</CardTitle>
              {wl.subtitle && (
                <p className="text-xs text-gray-400">{wl.subtitle}</p>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                {wl._count.items} item{wl._count.items !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {new Date(wl.createdAt).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
