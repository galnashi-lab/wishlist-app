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

async function ensureUser(user: { id?: string | null; name?: string | null; email?: string | null; image?: string | null }) {
  if (!user.id) return;
  return prisma.user.upsert({
    where: { id: user.id },
    update: {},
    create: { id: user.id, name: user.name, email: user.email, image: user.image },
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

// ─── URL Metadata Fetching ────────────────────────────────────────────────────

export async function fetchUrlMetadata(url: string): Promise<{
  image: string | null;
  price: number | null;
  currency: string | null;
  title: string | null;
}> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WishlistBot/1.0)" },
    });
    if (!res.ok) return { image: null, price: null, currency: null, title: null };

    const html = await res.text();

    // Extract og:image
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
      || null;

    // Extract og:title or <title>
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
      || null;

    let price: number | null = null;
    let currency: string | null = null;

    // 1. Schema.org JSON-LD (most reliable)
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]);
        const offers = data?.offers ?? data?.["@graph"]?.find((g: { offers?: unknown }) => g.offers)?.offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const p = offer?.price;
        const c = offer?.priceCurrency;
        if (p !== undefined) { price = parseFloat(String(p)); }
        if (c) { currency = String(c).toUpperCase(); }
        if (price) break;
      } catch { /* skip */ }
    }

    // 2. og:price meta tags
    if (!price) {
      const ogPrice = html.match(/<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:price:amount["']/i)?.[1];
      if (ogPrice) price = parseFloat(ogPrice);
    }
    if (!currency) {
      const ogCurrency = html.match(/<meta[^>]+property=["']og:price:currency["'][^>]+content=["']([^"']+)["']/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:price:currency["']/i)?.[1];
      if (ogCurrency) currency = ogCurrency.toUpperCase();
    }

    // 3. Common HTML price patterns
    if (!price) {
      const priceMatch = html.match(/["']price["']\s*:\s*["']?([\d]+\.?\d{0,2})["']?/)
        || html.match(/class=["'][^"']*price[^"']*["'][^>]*>\s*[^\d]*([\d]+\.?\d{0,2})/i);
      if (priceMatch) price = parseFloat(priceMatch[1]);
    }

    // 4. Infer currency from common symbols if still missing
    if (price && !currency) {
      if (html.match(/₪|ILS|shekel/i)) currency = "ILS";
      else if (html.match(/€|EUR/i)) currency = "EUR";
      else if (html.match(/£|GBP/i)) currency = "GBP";
      else if (html.match(/¥|JPY|CNY/i)) currency = "JPY";
      else currency = "USD"; // sensible default
    }

    return {
      image: ogImage,
      price: price && !isNaN(price) ? price : null,
      currency: price ? currency : null,
      title: ogTitle,
    };
  } catch {
    return { image: null, price: null, currency: null, title: null };
  }
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
  const currency = (formData.get("currency") as string)?.trim().toUpperCase() || null;
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

  await prisma.item.create({
    data: {
      name: name.trim(),
      sourceUrl: sourceUrl?.trim() || null,
      price,
      currency: price ? currency : null,
      imageUrl,
      category,
      rank: (maxRankItem?.rank ?? -1) + 1,
      wishlistId,
    },
  });

  revalidatePath(`/wishlist/${wishlistId}`);
}

export async function updateItem(itemId: string, wishlistId: string, formData: FormData) {
  await requireAuth();

  const name = formData.get("name") as string;
  const sourceUrl = formData.get("sourceUrl") as string;
  const price = formData.get("price") ? parseFloat(formData.get("price") as string) : null;
  const currency = (formData.get("currency") as string)?.trim().toUpperCase() || null;
  const imageUrlInput = formData.get("imageUrl") as string;
  const category = formData.get("category") as Category;

  if (!name?.trim()) throw new Error("Item name is required");

  let imageUrl: string | null = imageUrlInput?.trim() || null;
  if (imageUrl?.startsWith("http")) {
    imageUrl = await downloadImage(imageUrl) ?? imageUrl;
  }

  await prisma.item.update({
    where: { id: itemId },
    data: {
      name: name.trim(),
      sourceUrl: sourceUrl?.trim() || null,
      price,
      currency: price ? currency : null,
      imageUrl,
      category,
    },
  });

  revalidatePath(`/wishlist/${wishlistId}`);
}

export async function refreshItemMeta(itemId: string, wishlistId: string) {
  await requireAuth();

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item?.sourceUrl) return { updated: false, reason: "no_url" };

  const meta = await fetchUrlMetadata(item.sourceUrl);
  const updates: Record<string, unknown> = {};

  if (meta.price !== null && meta.price !== item.price) updates.price = meta.price;
  if (meta.currency && meta.currency !== item.currency) updates.currency = meta.currency;
  if (meta.image) {
    const localPath = await downloadImage(meta.image);
    if (localPath && localPath !== item.imageUrl) updates.imageUrl = localPath;
  }

  if (Object.keys(updates).length === 0) return { updated: false, reason: "no_change" };

  await prisma.item.update({ where: { id: itemId }, data: updates });
  revalidatePath(`/wishlist/${wishlistId}`);
  return { updated: true };
}

export async function refreshAllItems(wishlistId: string) {
  await requireAuth();

  const items = await prisma.item.findMany({
    where: { wishlistId, sourceUrl: { not: null } },
  });

  // Run in parallel with a concurrency cap of 5
  const results = await Promise.allSettled(
    items.map((item) => refreshItemMeta(item.id, wishlistId))
  );

  const updated = results.filter(
    (r) => r.status === "fulfilled" && r.value.updated
  ).length;

  revalidatePath(`/wishlist/${wishlistId}`);
  return { total: items.length, updated };
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
