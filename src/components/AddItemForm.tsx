"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { addItem, fetchUrlMetadata } from "@/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CURRENCIES = ["USD", "EUR", "GBP", "ILS", "JPY", "CAD", "AUD", "CHF", "CNY"];

export default function AddItemForm({ wishlistId }: { wishlistId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [name, setName] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function handleUrlBlur(e: React.FocusEvent<HTMLInputElement>) {
    const url = e.target.value.trim();
    if (!url || !url.startsWith("http")) return;
    setFetching(true);
    try {
      const meta = await fetchUrlMetadata(url);
      if (meta.image && !imageUrl) setImageUrl(meta.image);
      if (meta.price && !price) setPrice(String(meta.price));
      if (meta.currency) setCurrency(meta.currency);
      if (meta.title && !name) setName(meta.title.slice(0, 100));
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit(formData: FormData) {
    setPending(true);
    await addItem(wishlistId, formData);
    setPending(false);
    setOpen(false);
    setImageUrl("");
    setPrice("");
    setCurrency("USD");
    setName("");
    formRef.current?.reset();
    router.refresh();
  }

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-700">Add a new item</h2>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Cancel" : "+ Add Item"}
        </Button>
      </div>

      {open && (
        <form ref={formRef} action={handleSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 relative">
            <Input
              name="sourceUrl"
              placeholder="Source URL — paste to auto-fill name, image & price"
              type="url"
              onBlur={handleUrlBlur}
            />
            {fetching && (
              <span className="absolute right-3 top-2 text-xs text-indigo-400 animate-pulse">
                Fetching…
              </span>
            )}
          </div>

          <Input
            name="name"
            placeholder="Product name *"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {/* Price + Currency side by side */}
          <div className="flex gap-2">
            <Input
              name="price"
              placeholder="Price"
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="flex-1"
            />
            <select
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-24 border border-gray-200 rounded-md px-2 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <Input
              name="imageUrl"
              placeholder="Image URL (auto-filled or paste manually)"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <select
              name="category"
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              defaultValue="NICE_TO_HAVE"
            >
              <option value="MUST_HAVE">🔥 Must Have</option>
              <option value="NICE_TO_HAVE">✨ Nice to Have</option>
              <option value="DREAM_ITEM">💭 Dream Item</option>
            </select>
          </div>
          <Button type="submit" disabled={pending || fetching} className="sm:col-span-2">
            {pending ? "Adding…" : fetching ? "Fetching page data…" : "Add Item"}
          </Button>
        </form>
      )}
    </div>
  );
}
