"use client";

import { useRouter } from "next/navigation";
import { UserRound, Pencil, KeyRound, Settings, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { setDesignMode } from "@/app/design-actions";
import type { DesignMode } from "@/lib/design-mode";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function UserMenu({ name, email, role, design = "pulse" }: { name: string; email: string; role: string; design?: DesignMode }) {
  const router = useRouter();
  async function toggleDesign() {
    await setDesignMode(design === "filament" ? "pulse" : "filament");
    window.location.reload();
  }
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const go = (href: string) => () => router.push(href);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
            <Avatar className="size-7">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium sm:inline">{name}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        {/* Header — a plain div, NOT Menu.GroupLabel (which throws outside a Group). */}
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <Avatar className="size-8"><AvatarFallback className="text-xs">{initials}</AvatarFallback></Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
            <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <ShieldCheck className="size-3" /> {role === "admin" ? "Administrator" : role}
            </span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onClick={go("/account")}>
          <UserRound className="size-4" /> View profile
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={go("/account?edit=1")}>
          <Pencil className="size-4" /> Edit profile
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={go("/account?section=password")}>
          <KeyRound className="size-4" /> Change password
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={go("/settings")}>
          <Settings className="size-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2" onClick={toggleDesign}>
          <Sparkles className="size-4 text-primary" />
          {design === "filament" ? "Switch to Pulse (classic)" : "Try Filament (new design)"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" className="gap-2" onClick={() => logoutAction()}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
