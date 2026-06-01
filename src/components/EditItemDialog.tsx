"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateItem } from "@/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Category } from "@prisma/client";

const CURRENCIES = ["USD", "EUR", "GBP", "ILS", "JPY", "CAD", "AUD", "CHF", "CNY"];

type Item = {
  id: string;
  name: string;
  sourceUrl: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  category: Category;
};

export default function EditItemDialog({
  item,
  wishlistId,
  open,
  onClose,
}: {
  item: Item;
  wishlistId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? "");
  const [price, setPrice] = useState(item.price != null ? String(item.price) : "");
  const [currency, setCurrency] = useState(item.currency ?? "USD");
  const [name, setName] = useState(item.name);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    await updateItem(item.id, wishlistId, formData);
    setPending(false);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3 mt-2">
          <Input
            name="name"
            placeholder="Product name *"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            name="sourceUrl"
            placeholder="Source URL"
            type="url"
            defaultValue={item.sourceUrl ?? ""}
          />
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
          <Input
            name="imageUrl"
            placeholder="Image URL"
            type="url"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          <select
            name="category"
            defaultValue={item.category}
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value="MUST_HAVE">🔥 Must Have</option>
            <option value="NICE_TO_HAVE">✨ Nice to Have</option>
            <option value="DREAM_ITEM">💭 Dream Item</option>
          </select>
          <div className="flex gap-2 mt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
