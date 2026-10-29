import { CircleAlert, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Shows the last server rejection, e.g. "DEV-3 is claimed by Worker w-ab12". */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="px-4 pt-3">
      <Alert variant="destructive" className="pr-12">
        <CircleAlert />
        <AlertDescription>{message}</AlertDescription>
        <Button variant="ghost" size="icon-xs" className="absolute top-2.5 right-2.5" onClick={onDismiss} aria-label="Dismiss">
          <X />
        </Button>
      </Alert>
    </div>
  );
}

/** Runs a server call; reports failures to the banner. Resolves true on success. */
export type Act = (fn: () => Promise<unknown>) => Promise<boolean>;
