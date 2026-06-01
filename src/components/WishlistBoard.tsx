"use client";

import { useState, useTransition } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd";
import { reorderItems, togglePurchased } from "@/actions/wishlist";
import { Category } from "@prisma/client";
import Image from "next/image";
import EditItemDialog from "@/components/EditItemDialog";

type Item = {
  id: string;
  name: string;
  sourceUrl: string | null;
  price: number | null;
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

  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const category = source.droppableId as Category;
    if (category !== destination.droppableId) return;

    const newList = Array.from(items[category]);
    const [moved] = newList.splice(source.index, 1);
    newList.splice(destination.index, 0, moved);

    setItems((prev) => ({ ...prev, [category]: newList }));
    startTransition(() => {
      reorderItems(wishlistId, category, newList.map((i) => i.id));
    });
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
            onItemUpdated={(updatedItem) => {
              setItems((prev) => ({
                ...prev,
                // Remove from old category, add to new if changed
                ...Object.fromEntries(
                  (Object.keys(prev) as Category[]).map((c) => [
                    c,
                    c === updatedItem.category
                      ? prev[c].some((i) => i.id === updatedItem.id)
                        ? prev[c].map((i) => i.id === updatedItem.id ? updatedItem : i)
                        : [...prev[c], updatedItem]
                      : prev[c].filter((i) => i.id !== updatedItem.id),
                  ])
                ),
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
  category, label, items, wishlistId, onItemUpdated, onToggle,
}: {
  category: Category;
  label: string;
  items: Item[];
  wishlistId: string;
  onItemUpdated: (item: Item) => void;
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
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="space-y-2 min-h-[48px]"
          >
            {items.map((item, index) => (
              <DraggableItem
                key={item.id}
                item={item}
                index={index}
                wishlistId={wishlistId}
                onItemUpdated={onItemUpdated}
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
  item, index, wishlistId, onItemUpdated, onToggle,
}: {
  item: Item;
  index: number;
  wishlistId: string;
  onItemUpdated: (item: Item) => void;
  onToggle: (itemId: string, purchased: boolean) => void;
}) {
  const [purchasing, setPurchasing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function handleToggle() {
    setPurchasing(true);
    onToggle(item.id, !item.isPurchased);
    await togglePurchased(item.id, wishlistId);
    setPurchasing(false);
  }

  return (
    <>
      <Draggable draggableId={item.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
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
            <span className="text-gray-300 cursor-grab shrink-0">⠿</span>

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
                <p className="text-xs text-gray-400">${item.price.toFixed(2)}</p>
              )}
            </div>

            {/* Edit button */}
            <button
              onClick={() => setEditOpen(true)}
              className="shrink-0 text-xs px-2 py-1 rounded-full border border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
            >
              ✏️
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
