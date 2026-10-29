import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Renders a Story body. Raw HTML in the source is shown as text, not rendered. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
