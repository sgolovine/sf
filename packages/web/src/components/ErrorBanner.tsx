/** Shows the last server rejection, e.g. "DEV-3 is claimed by Worker w-ab12". */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/** Runs a server call; reports failures to the banner. Resolves true on success. */
export type Act = (fn: () => Promise<unknown>) => Promise<boolean>;
