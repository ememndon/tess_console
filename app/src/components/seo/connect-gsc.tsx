import { PlugZap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Placeholder state for the Google-Search-Console-powered views.
// GSC needs a one-time owner connection; until then these explain what will
// appear and how to switch them on.
export function ConnectGsc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border bg-card">
          <PlugZap className="size-5 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{children}</p>
        <Badge variant="outline" className="text-muted-foreground">
          Connect Google Search Console to enable
        </Badge>
      </CardContent>
    </Card>
  );
}
