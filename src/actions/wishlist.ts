"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeFile } from "fs/promises";
import path from "path";
import { Category } from "@prisma/client";

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

// Ensure user exists in DB (upsert on first use)
async function ensureUser(user: { id?: string | null; name?: string | null; email?: string | null; image?: string | null }) {
  if (!user.id) return;
  return prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    },
  });
}

// ─── Wishlists ────────────────────────────────────────────────────────────────

export async function createWishlist(formData: FormData) {
  const user = await requireAuth();
  await ensureUser(user);

  const name = formData.get("name") as string;
  if (!name?.trim()) throw new Error("Name is required");

  const wishlist = await prisma.wishlist.create({
    data: { name: name.trim(), ownerId: user.id! },
  });

  revalidatePath("/dashboard");
  redirect(`/wishlist/${wishlist.id}`);
}

export async function getWishlists() {
  const user = await requireAuth();
  return prisma.wishlist.findMany({
    where: { ownerId: user.id! },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Items ────────────────────────────────────────────────────────────────────

async function downloadImage(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = imageUrl.split(".").pop()?.split("?")[0]?.toLowerCase() || "jpg";
    const safeExt = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext) ? ext : "jpg";
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
    const uploadPath = path.join(process.cwd(), "public", "uploads", filename);

    await writeFile(uploadPath, buffer);
    return `/uploads/${filename}`;
  } catch {
    return null;
  }
}

export async function addItem(wishlistId: string, formData: FormData) {
  const user = await requireAuth();
  await ensureUser(user);

  const wishlist = await prisma.wishlist.findUnique({ where: { id: wishlistId } });
  if (!wishlist) throw new Error("Wishlist not found");

  const name = formData.get("name") as string;
  const sourceUrl = formData.get("sourceUrl") as string;
  const price = formData.get("price") ? parseFloat(formData.get("price") as string) : null;
  const imageUrlInput = formData.get("imageUrl") as string;
  const category = (formData.get("category") as Category) || "NICE_TO_HAVE";

  if (!name?.trim()) throw new Error("Item name is required");

  let imageUrl: string | null = null;
  if (imageUrlInput?.trim()) {
    imageUrl = await downloadImage(imageUrlInput.trim());
  }

  const maxRankItem = await prisma.item.findFirst({
    where: { wishlistId, category },
    orderBy: { rank: "desc" },
  });
  const rank = (maxRankItem?.rank ?? -1) + 1;

  await prisma.item.create({
    data: {
      name: name.trim(),
      sourceUrl: sourceUrl?.trim() || null,
      price,
      imageUrl,
      category,
      rank,
      wishlistId,
    },
  });

  revalidatePath(`/wishlist/${wishlistId}`);
}

export async function reorderItems(wishlistId: string, category: Category, orderedIds: string[]) {
  await requireAuth();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.item.update({ where: { id }, data: { rank: index } })
    )
  );

  revalidatePath(`/wishlist/${wishlistId}`);
}

export async function togglePurchased(itemId: string, wishlistId: string) {
  const user = await requireAuth();
  await ensureUser(user);

  await prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({ where: { id: itemId } });
    if (!item) throw new Error("Item not found");

    await tx.item.update({
      where: { id: itemId },
      data: {
        isPurchased: !item.isPurchased,
        purchasedById: !item.isPurchased ? user.id! : null,
      },
    });
  });

  revalidatePath(`/wishlist/${wishlistId}`);
}
