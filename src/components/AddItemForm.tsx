"use client";

import { useState } from "react";
import { addItem } from "@/actions/wishlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AddItemForm({ wishlistId }: { wishlistId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    await addItem(wishlistId, formData);
    setPending(false);
    setOpen(false);
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
        <form action={handleSubmit} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input name="name" placeholder="Product name *" required />
          <Input name="sourceUrl" placeholder="Source URL" type="url" />
          <Input name="price" placeholder="Price (e.g. 49.99)" type="number" step="0.01" min="0" />
          <Input name="imageUrl" placeholder="Image URL" type="url" />
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
          <Button type="submit" disabled={pending} className="sm:col-span-2">
            {pending ? "Adding..." : "Add Item"}
          </Button>
        </form>
      )}
    </div>
  );
}
