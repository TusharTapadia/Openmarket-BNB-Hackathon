import { ChartNoAxesCombined, SearchX } from "lucide-react";
import { SkeletonTable } from "./skeleton";
export function DataState({ title, description, loading = false, error = false, action, actionLabel = "Try again" }: {
  title: string; description: string; loading?: boolean; error?: boolean; action?: () => void; actionLabel?: string;
}) {
  // Loading draws the shape of what is coming instead of a spinner; error and
  // empty states keep their message and action.
  if (loading) { return <div className="sk-state"><SkeletonTable rows={5} cols={5} label={title} /></div>; }
  return <div className={`empty-state ${loading ? "loading-state" : ""}`} role={error ? "alert" : "status"}>
    <span className="empty-icon">{error ? <ChartNoAxesCombined size={25} /> : <SearchX size={25} />}</span>
    <strong>{title}</strong><p>{description}</p>
    {action && <button className="secondary-button" type="button" onClick={action}>{actionLabel}</button>}
  </div>;
}
