"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plug, CheckCircle2, XCircle, Circle, KeyRound } from "lucide-react";
import { saveSecret, clearSecret, testSecret } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type VaultRow = {
  key: string;
  label: string;
  category: string;
  help: string;
  placeholder?: string;
  testable: boolean;
  configured: boolean;
  status: "unset" | "untested" | "ok" | "failed";
  lastTested: string | null;
  updatedInfo: string | null;
};

function StatusBadge({ status }: { status: VaultRow["status"] }) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3" /> Connected
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="size-3" /> Failed
        </Badge>
      );
    case "untested":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Circle className="size-3" /> Untested
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground/70">
          Not set
        </Badge>
      );
  }
}

function SecretRow({ row }: { row: VaultRow }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  function onSave() {
    startSave(async () => {
      const r = await saveSecret(row.key, value);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setValue("");
      } else {
        toast.error(r.message);
      }
    });
  }

  function onClear() {
    startSave(async () => {
      const r = await clearSecret(row.key);
      toast.message(r.message);
      setOpen(false);
    });
  }

  function onTest() {
    startTest(async () => {
      const r = await testSecret(row.key);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  }

  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.label}</span>
          <StatusBadge status={row.status} />
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{row.help}</p>
        {row.updatedInfo && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
            Updated {row.updatedInfo}
            {row.lastTested ? ` · tested ${row.lastTested}` : ""}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {row.testable && row.configured && (
          <Button variant="outline" size="sm" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
            Test
          </Button>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant={row.configured ? "outline" : "default"} size="sm">
                {row.configured ? "Update" : "Set"}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4" />
                {row.configured ? "Update" : "Set"} {row.label}
              </DialogTitle>
              <DialogDescription>{row.help}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`secret-${row.key}`}>Value</Label>
              <Input
                id={`secret-${row.key}`}
                type="password"
                autoComplete="off"
                placeholder={row.placeholder ?? "Paste the key or token"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Encrypted on save and never shown again — re-enter to change it.
              </p>
            </div>
            <DialogFooter>
              {row.configured && (
                <Button
                  variant="destructive"
                  onClick={onClear}
                  disabled={saving}
                  className="sm:mr-auto"
                >
                  Remove
                </Button>
              )}
              <Button onClick={onSave} disabled={saving || !value.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export function SecretsVault({
  groups,
}: {
  groups: { category: string; items: VaultRow[] }[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Card key={group.category}>
          <CardHeader>
            <CardTitle className="text-base">{group.category}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y py-0">
            {group.items.map((item) => (
              <SecretRow key={item.key} row={item} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
