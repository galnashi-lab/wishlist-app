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
  const empty = { image: null, price: null, currency: null, title: null };
  try {
    // Try direct fetch first, then microlink as fallback for image
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    if (!res.ok) return empty;
    const html = await res.text();

    // ── Title ──────────────────────────────────────────────────────────────
    const title =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
      html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
      null;

    // ── Image — 5 fallback layers ───────────────────────────────────────
    let image: string | null =
      // 1. og:image (both attribute orders)
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
      // 2. og:image:url variant
      html.match(/<meta[^>]+property=["']og:image:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      // 3. twitter:image
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1] ||
      // 4. link rel=image_src
      html.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i)?.[1] ||
      null;

    // 5. Microlink API fallback for image (free tier, no key needed)
    if (!image) {
      try {
        const ml = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=false`, {
          signal: AbortSignal.timeout(5000),
        });
        if (ml.ok) {
          const data = await ml.json();
          image = data?.data?.image?.url || data?.data?.logo?.url || null;
        }
      } catch { /* skip */ }
    }

    // Make relative image URLs absolute
    if (image && !image.startsWith("http")) {
      const base = new URL(url);
      image = new URL(image, base.origin).toString();
    }

    // ── Price & Currency ────────────────────────────────────────────────
    let price: number | null = null;
    let currency: string | null = null;

    // 1. Schema.org JSON-LD
    for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(match[1]);
        const graph = data?.["@graph"] ?? (Array.isArray(data) ? data : [data]);
        for (const node of graph) {
          const offers = node?.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          if (offer?.price !== undefined) {
            price = parseFloat(String(offer.price));
            if (offer.priceCurrency) currency = String(offer.priceCurrency).toUpperCase();
            break;
          }
        }
        if (price) break;
      } catch { /* skip */ }
    }

    // 2. og:price meta tags
    if (!price) {
      const ogPrice =
        html.match(/<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:price:amount["']/i)?.[1];
      if (ogPrice) price = parseFloat(ogPrice);
      const ogCur =
        html.match(/<meta[^>]+property=["']og:price:currency["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:price:currency["']/i)?.[1];
      if (ogCur) currency = ogCur.toUpperCase();
    }

    // 3. Inline JSON price
    if (!price) {
      const m = html.match(/"price"\s*:\s*"?([\d]+\.?\d{0,2})"?/) ||
        html.match(/class=["'][^"']*price[^"']*["'][^>]*>\s*[^\d]*([\d]+\.?\d{0,2})/i);
      if (m) price = parseFloat(m[1]);
    }

    // 4. Infer currency from symbols
    if (price && !currency) {
      if (html.match(/₪|ILS|shekel/i)) currency = "ILS";
      else if (html.match(/€|EUR/)) currency = "EUR";
      else if (html.match(/£|GBP/)) currency = "GBP";
      else if (html.match(/¥|JPY|CNY/)) currency = "JPY";
      else currency = "USD";
    }

    return {
      image,
      price: price && !isNaN(price) ? price : null,
      currency: price ? currency : null,
      title,
    };
  } catch {
    return empty;
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

export async function deleteItem(itemId: string, wishlistId: string) {
  await requireAuth();
  await prisma.item.delete({ where: { id: itemId } });
  revalidatePath(`/wishlist/${wishlistId}`);
}

export async function moveItemToCategory(
  itemId: string,
  wishlistId: string,
  newCategory: Category,
  newIndex: number
) {
  await requireAuth();
  // Shift existing items in target category to make room
  const siblings = await prisma.item.findMany({
    where: { wishlistId, category: newCategory, id: { not: itemId } },
    orderBy: { rank: "asc" },
  });
  siblings.splice(newIndex, 0, { id: itemId } as typeof siblings[0]);
  await prisma.$transaction([
    prisma.item.update({ where: { id: itemId }, data: { category: newCategory, rank: newIndex } }),
    ...siblings
      .filter((s) => s.id !== itemId)
      .map((s, i) =>
        prisma.item.update({ where: { id: s.id }, data: { rank: i >= newIndex ? i + 1 : i } })
      ),
  ]);
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
