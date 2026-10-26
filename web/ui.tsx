import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { Badge } from "@cloudflare/kumo/components/badge";
import { statusLabels, accountLabels } from "./model";
const paths = {
  dashboard: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  posts:
    "M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M8 3v4h8V3H8m4 12 7-7 3 3-7 7h-3v-3Z",
  compose: "M12 5v14M5 12h14",
  schedule:
    "M8 3v4m8-4v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2m3 10h3m-3 3h7",
  insights: "M4 20V10h4v10m4 0V4h4v16m4 0v-7h2v7M2 20h21",
  accounts: "M20 21v-2a7 7 0 0 0-14 0v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  logout: "M9 4H4v16h5m4-4 4-4-4-4m-5 4h14",
  image: "M3 3h18v18H3ZM3 16l5-5 4 4 4-6 5 7M8 7h.01",
  video: "M3 5h13v14H3Zm13 5 6-4v12l-6-4",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  help: "M12 17h.01M9 9a3 3 0 1 1 5 2c-1 .7-2 1-2 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  check: "m5 12 4 4L19 6",
  search: "m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
};
export function Icon({
  name,
  size = 20,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Status({ status }: { status: string }) {
  const tone =
    status === "published" || status === "connected"
      ? "success"
      : ["needs_review", "failed", "expired", "reauth_required"].includes(
            status,
          )
        ? "error"
        : ["creating", "processing", "publishing"].includes(status)
          ? "warning"
          : status === "queued"
            ? "info"
            : "secondary";
  return (
    <Badge
      variant={tone}
      appearance={tone === "info" || tone === "secondary" ? "filled" : "dot"}
      className="status-badge"
    >
      {statusLabels[status] ?? accountLabels[status] ?? status}
    </Badge>
  );
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-heading">
          <div>
            <h2>{title}</h2>
            {description && <p className="muted small">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name="posts" size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <Button
          variant="ghost"
          aria-label="閉じる"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="close" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
