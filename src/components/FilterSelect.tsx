"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { findSelectMatch, getSelectPlacement, type SelectOption } from "@/lib/filter-select";

interface FilterSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}

export function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef({ query: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<ReturnType<typeof getSelectPlacement> | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  function updatePlacement() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPlacement(getSelectPlacement(trigger.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    }, options.length));
  }

  function openMenu(index = Math.max(0, selectedIndex)) {
    updatePlacement();
    setActiveIndex(index);
    searchRef.current = { query: "", time: 0 };
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function reposition(event?: Event) {
      // Scrolling the options should not move or dismiss their own menu.
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
      if (event?.type === "scroll") {
        setOpen(false);
        return;
      }
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPlacement(getSelectPlacement(trigger.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }, options.length));
    }
    function dismissOutside(event: Event) {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    const observer = new ResizeObserver(() => reposition());
    if (triggerRef.current) observer.observe(triggerRef.current);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      observer.disconnect();
    };
  }, [open, options.length]);

  useEffect(() => {
    if (open) menuRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) openMenu(selectedIndex >= 0 ? selectedIndex : event.key === "ArrowUp" ? options.length - 1 : 0);
        else setActiveIndex((index) => Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      case "Home":
      case "End":
        event.preventDefault();
        if (!open) openMenu(event.key === "Home" ? 0 : options.length - 1);
        else setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
        return;
      case "Enter":
      case " ":
        if (event.key === " " && open && searchRef.current.query && Date.now() - searchRef.current.time < 700) break;
        event.preventDefault();
        if (open) choose(activeIndex);
        else openMenu();
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      const now = Date.now();
      const query = (now - searchRef.current.time < 700 ? searchRef.current.query : "") + event.key;
      searchRef.current = { query, time: now };
      const index = findSelectMatch(options, query, open ? activeIndex : Math.max(0, selectedIndex));
      if (open) setActiveIndex(index);
      else {
        openMenu(index);
        searchRef.current = { query, time: now };
      }
    }
  }

  return (
    <div>
      <label id={`${id}-label`} htmlFor={id} className="mb-1 block text-xs font-medium text-stone-500">{label}</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-activedescendant={open && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={handleKeyDown}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border bg-stone-800 px-3 py-2 text-left text-stone-100 transition-colors hover:border-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${open ? "border-amber-500/70" : "border-stone-700"}`}
      >
        <span id={`${id}-value`} className="min-w-0 truncate">{selected?.label ?? value}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && placement && createPortal(
        <ul
          ref={menuRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          className="app-scrollbar fixed z-[10001] overflow-y-auto overscroll-contain rounded-xl border border-stone-600 bg-stone-900 p-1 shadow-xl shadow-black/40"
          style={placement}
        >
          {options.map((option, index) => (
            <li
              id={`${id}-option-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onPointerMove={(event) => { if (event.pointerType === "mouse") setActiveIndex(index); }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
              className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${index === activeIndex ? "bg-stone-700/80" : ""} ${option.value === value ? "font-medium text-amber-400" : "text-stone-200"}`}
            >
              <span className="min-w-0 break-words">{option.label}</span>
              {option.value === value && <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </li>
          ))}
        </ul>, document.body,
      )}
    </div>
  );
}
