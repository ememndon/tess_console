"use client";

import { useEffect, useState } from "react";
import { TessAvatar } from "@/components/tess-avatar";

// Tess's welcome line on the Site Overview. Time-of-day is read from the admin's
// own browser clock (correct regardless of server/UTC), and the message is picked
// at random from a pool so she doesn't sound like a recording. {name} → first name.
const POOLS = {
  morning: [
    "Good morning, {name}. How can I help you start the day?",
    "Morning, {name}! What should we tackle first?",
    "Good morning, {name}. How may I be of assistance today?",
    "Rise and shine, {name}. What's on the agenda?",
    "Good morning, {name}. I'm ready when you are.",
    "Morning, {name}. Anything you'd like me to look into?",
    "Good morning, {name}. Shall I run you through the overnight numbers?",
  ],
  afternoon: [
    "Good afternoon, {name}. What can I do for you?",
    "Afternoon, {name}! How can I help right now?",
    "Good afternoon, {name}. Anything I can take off your plate?",
    "Hope the day is going well, {name}. What's next?",
    "Good afternoon, {name}. How may I assist?",
    "Afternoon, {name}. Want me to dig into anything?",
    "Good afternoon, {name}. The sites are in hand. What do you need?",
  ],
  evening: [
    "Good evening, {name}. Anything I can help you with today?",
    "Evening, {name}! What would you like to look at?",
    "Good evening, {name}. How may I be of assistance?",
    "Good evening, {name}. I'm here if you need anything.",
    "Evening, {name}. Want me to check on the sites?",
    "Good evening, {name}. What can I do for you tonight?",
    "Evening, {name}. Shall I pull together a recap of the day?",
  ],
  night: [
    "Working late, {name}? How can I help?",
    "Burning the midnight oil, {name}? What do you need?",
    "Still up, {name}? I've got the night shift covered. What's on your mind?",
    "Late night, {name}? Tell me what you'd like me to handle.",
    "Good evening, {name}. I'm still here. What can I do?",
    "Up late, {name}? Let me know how I can help.",
  ],
} as const;

function partOfDay(h: number): keyof typeof POOLS {
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

export function TessGreeting({ name }: { name: string }) {
  // Empty on first paint (server + hydration match); filled on mount so the
  // random pick + local time never trigger a hydration mismatch.
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const pool = POOLS[partOfDay(new Date().getHours())];
    setMsg(pool[Math.floor(Math.random() * pool.length)].replace("{name}", name));
  }, [name]);

  return (
    <div className="flex items-center gap-3">
      <TessAvatar className="size-11 shrink-0 ring-2 ring-primary/30" />
      <p className="min-h-9 text-3xl font-semibold tracking-tight leading-tight text-foreground">{msg}</p>
    </div>
  );
}
