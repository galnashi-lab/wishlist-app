"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import { reorderItems, togglePurchased, refreshItemMeta, deleteItem, moveItemToCategory } from "@/actions/wishlist";
import { Category } from "@prisma/client";
import Image from "next/image";
import EditItemDialog from "@/components/EditItemDialog";

function formatPrice(price: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency ?? "$"}${price.toFixed(2)}`;
  }
}

type Item = {
  id: string;
  name: string;
  sourceUrl: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  category: Category;
  rank: number;
  isPurchased: boolean;
};

type Grouped = Record<Category, Item[]>;

export default function WishlistBoard({
  wishlistId,
  grouped,
  categoryLabels,
}: {
  wishlistId: string;
  grouped: Grouped;
  categoryLabels: Record<Category, string>;
}) {
  const [items, setItems] = useState<Grouped>(grouped);
  const [, startTransition] = useTransition();

  // Sync local state when server re-renders after router.refresh()
  useEffect(() => {
    setItems(grouped);
  }, [grouped]);

  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const srcCat = source.droppableId as Category;
    const dstCat = destination.droppableId as Category;

    if (srcCat === dstCat) {
      // Reorder within same category
      const newList = Array.from(items[srcCat]);
      const [moved] = newList.splice(source.index, 1);
      newList.splice(destination.index, 0, moved);
      setItems((prev) => ({ ...prev, [srcCat]: newList }));
      startTransition(() => {
        reorderItems(wishlistId, srcCat, newList.map((i) => i.id));
      });
    } else {
      // Move across categories
      const srcList = Array.from(items[srcCat]);
      const dstList = Array.from(items[dstCat]);
      const [moved] = srcList.splice(source.index, 1);
      const updated = { ...moved, category: dstCat };
      dstList.splice(destination.index, 0, updated);
      setItems((prev) => ({ ...prev, [srcCat]: srcList, [dstCat]: dstList }));
      startTransition(() => {
        moveItemToCategory(moved.id, wishlistId, dstCat, destination.index);
      });
    }
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="space-y-6">
        {(Object.keys(categoryLabels) as Category[]).map((cat) => (
          <CategoryColumn
            key={cat}
            category={cat}
            label={categoryLabels[cat]}
            items={items[cat]}
            wishlistId={wishlistId}
            onDelete={(itemId) => {
              setItems((prev) => ({
                ...prev,
                [cat]: prev[cat].filter((i) => i.id !== itemId),
              }));
            }}
            onToggle={(itemId, purchased) => {
              setItems((prev) => ({
                ...prev,
                [cat]: prev[cat].map((i) =>
                  i.id === itemId ? { ...i, isPurchased: purchased } : i
                ),
              }));
            }}
          />
        ))}
      </div>
    </DragDropContext>
  );
}

function CategoryColumn({
  category, label, items, wishlistId, onDelete, onToggle,
}: {
  category: Category;
  label: string;
  items: Item[];
  wishlistId: string;
  onDelete: (itemId: string) => void;
  onToggle: (itemId: string, purchased: boolean) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="font-semibold text-gray-700 mb-3">
        {label}
        <span className="ml-2 text-xs text-gray-400 font-normal">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </h3>
      <Droppable droppableId={category}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`space-y-2 min-h-[48px] rounded-lg transition-colors ${
              snapshot.isDraggingOver ? "bg-indigo-50" : ""
            }`}
          >
            {items.map((item, index) => (
              <DraggableItem
                key={item.id}
                item={item}
                index={index}
                wishlistId={wishlistId}
                onDelete={onDelete}
                onToggle={onToggle}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

function DraggableItem({
  item, index, wishlistId, onDelete, onToggle,
}: {
  item: Item;
  index: number;
  wishlistId: string;
  onDelete: (itemId: string) => void;
  onToggle: (itemId: string, purchased: boolean) => void;
}) {
  const [purchasing, setPurchasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState<boolean | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    setPurchasing(true);
    onToggle(item.id, !item.isPurchased);
    await togglePurchased(item.id, wishlistId);
    setPurchasing(false);
  }

  async function handleRefresh() {
    if (!item.sourceUrl) return;
    setRefreshing(true);
    setRefreshed(null);
    const result = await refreshItemMeta(item.id, wishlistId);
    setRefreshing(false);
    setRefreshed(result.updated);
    if (result.updated) router.refresh();
    setTimeout(() => setRefreshed(null), 2000);
  }

  async function handleDelete() {
    if (!confirm(`Remove "${item.name}"?`)) return;
    setDeleting(true);
    onDelete(item.id);
    await deleteItem(item.id, wishlistId);
  }

  return (
    <>
      <Draggable draggableId={item.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
              item.isPurchased
                ? "bg-gray-50 border-gray-100 opacity-60"
                : "bg-white border-gray-200 hover:border-indigo-200"
            } ${snapshot.isDragging ? "shadow-lg ring-2 ring-indigo-300" : ""}`}
          >
            {/* Rank */}
            <span className="text-xs text-gray-400 w-5 text-center font-mono shrink-0">
              {index + 1}
            </span>

            {/* Drag handle */}
            <span {...provided.dragHandleProps} className="text-gray-300 cursor-grab shrink-0 touch-none">
              ⠿
            </span>

            {/* Image */}
            <div className="w-10 h-10 rounded bg-gray-100 shrink-0 overflow-hidden relative">
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.name}
                  fill
                  className="object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              ) : (
                <span className="flex items-center justify-center h-full text-lg">🎁</span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className={`font-medium text-sm truncate ${item.isPurchased ? "line-through text-gray-400" : "text-gray-800"}`}>
                {item.sourceUrl ? (
                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
                    className="hover:underline" onClick={(e) => e.stopPropagation()}>
                    {item.name}
                  </a>
                ) : item.name}
              </p>
              {item.price != null && (
                <p className="text-xs text-gray-400">{formatPrice(item.price, item.currency)}</p>
              )}
            </div>

            {/* Refresh */}
            {item.sourceUrl && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="Re-fetch price & image from source URL"
                className={`shrink-0 text-xs px-2 py-1 rounded-full border transition-colors ${
                  refreshed === true ? "border-green-300 text-green-600"
                  : refreshed === false ? "border-gray-200 text-gray-300"
                  : "border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500"
                }`}
              >
                {refreshing ? "⟳" : refreshed === true ? "✓" : refreshed === false ? "–" : "↻"}
              </button>
            )}

            {/* Edit */}
            <button
              onClick={() => setEditOpen(true)}
              className="shrink-0 text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
            >
              ✏️
            </button>

            {/* Delete */}
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Remove item"
              className="shrink-0 text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500 transition-colors"
            >
              🗑
            </button>

            {/* Purchased toggle */}
            <button
              onClick={handleToggle}
              disabled={purchasing}
              className={`shrink-0 text-xs px-2 py-1 rounded-full border transition-colors ${
                item.isPurchased
                  ? "bg-green-100 border-green-200 text-green-700"
                  : "bg-white border-gray-200 text-gray-500 hover:border-green-300 hover:text-green-600"
              }`}
            >
              {item.isPurchased ? "✓ Purchased" : "Mark Purchased"}
            </button>
          </div>
        )}
      </Draggable>

      <EditItemDialog
        item={item}
        wishlistId={wishlistId}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </>
  );
}
