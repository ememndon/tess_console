"use client";

import { useRef, useState } from "react";
import { Play, Pause, Check, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { VoiceOption } from "./demo-client";

const nameOf = (value: string) => value.split(":")[1] ?? value;

// Voice picker with a ▶ preview button on every row (plays the pre-rendered sample
// from media/assets/voices/<name>.mp3). Clicking the label selects the voice.
export function VoicePicker({ voices, value, onChange }: { voices: VoiceOption[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const current = voices.find((v) => v.value === value) ?? voices[0];

  function stop() {
    audioRef.current?.pause();
    setPlaying(null);
  }

  function preview(v: string) {
    const a = audioRef.current;
    if (!a) return;
    if (playing === v) {
      stop();
      return;
    }
    a.src = `/api/media/assets/voices/${nameOf(v)}.mp3`;
    a.play().then(() => setPlaying(v)).catch(() => setPlaying(null));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) stop();
      }}
    >
      <DialogTrigger render={<Button variant="outline" className="w-full justify-start gap-2 font-normal" />}>
        <Mic className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{current?.label ?? "Pick a voice"}</span>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a voice — tap ▶ to preview</DialogTitle>
        </DialogHeader>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} onEnded={() => setPlaying(null)} className="hidden" />
        <div className="-mr-1 flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
          {voices.map((v) => {
            const selected = v.value === value;
            const isPlaying = playing === v.value;
            return (
              <div
                key={v.value}
                className={`flex items-center gap-2 rounded-md border px-2 py-1 ${selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  onClick={() => preview(v.value)}
                  aria-label={`Preview ${v.label}`}
                >
                  {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
                <button
                  type="button"
                  className="flex-1 truncate text-left text-sm"
                  onClick={() => {
                    onChange(v.value);
                    stop();
                    setOpen(false);
                  }}
                >
                  {v.label}
                </button>
                {selected && <Check className="size-4 shrink-0 text-primary" />}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
