"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui/primitives";
import type { AIStateDTO, AIRunDTO, ToteDetailDTO } from "@/lib/contracts";
import "./ai-suggestions.css";

type Props = {
  detail: ToteDetailDTO;
  busy: boolean;
  onAdded: (detail: ToteDetailDTO, count: number) => Promise<void> | void;
  onBusyChange: (value: boolean) => void;
};
type DraftRow = { id: string; name: string; quantity: string; note: string; selected: boolean };
function cleanName(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " "); }
function normalizedName(value: string) { return cleanName(value).toLowerCase(); }
function validQuantity(value: string) {
  return /^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 100000;
}
function pending(run: AIRunDTO | null | undefined) { return run?.status === "queued" || run?.status === "running"; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Please try again."; }
async function request<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store", signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Suggestions could not be loaded. Please try again.");
  return data as T;
}

export function AISuggestions({ detail, busy, onAdded, onBusyChange }: Props) {
  const [ai, setAI] = useState<AIStateDTO | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [showAccepted, setShowAccepted] = useState(false);
  const [error, setError] = useState("" );
  const [loadError, setLoadError] = useState("" );
  const [reload, setReload] = useState(0);
  const alive = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const revision = useRef(0);
  const draftRun = useRef<string | null>(null);
  const latestDetail = useRef(detail);
  const busyCallback = useRef(onBusyChange);
  const heldBusy = useRef(false);
  latestDetail.current = detail;
  busyCallback.current = onBusyChange;
  const toteId = detail.tote.id;
  const photoId = detail.tote.photo?.id;
  const contentsUpdatedAt = detail.tote.contentsUpdatedAt;
  const endpoint = `/api/totes/${toteId}/suggestions`;

  const adopt = useCallback((next: AIStateDTO) => {
    if (!alive.current) return;
    setAI(next);
    const run = next.run;
    if (run?.status === "ready") {
      const existing = new Set(latestDetail.current.items.map(item => normalizedName(item.name)));
      const sameRun = draftRun.current === run.id;
      const hidden = new Set(run.dismissedSuggestionIds);
      setRows(previous => {
        const seen = new Set<string>();
        return run.suggestions.filter(item => !hidden.has(item.id)).map(item => {
          const name = normalizedName(item.name);
          const selected = !existing.has(name) && !seen.has(name);
          seen.add(name);
          const saved = sameRun ? previous.find(row => row.id === item.id) : undefined;
          if (saved) return saved;
          return { id: item.id, name: item.name, quantity: String(item.quantity), note: item.note, selected };
        });
      });
      draftRun.current = run.id;
    } else {
      setRows([]);
      draftRun.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      if (heldBusy.current) {
        heldBusy.current = false;
        busyCallback.current(false);
      }
    };
  }, [toteId]);

  useEffect(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    async function read() {
      const currentRevision = revision.current;
      try {
        const next = await request<AIStateDTO>(endpoint, controller.signal);
        if (controller.signal.aborted || !alive.current) return;
        if (currentRevision !== revision.current) {
          timer = setTimeout(read, 3000);
          return;
        }
        adopt(next);
        setLoadError("");
        if (pending(next.run)) timer = setTimeout(read, 3000);
      } catch (issue) {
        if (!controller.signal.aborted && alive.current) {
          setLoadError(errorMessage(issue));
          timer = setTimeout(read, 3000);
        }
      } finally {
        if (!controller.signal.aborted && alive.current) setLoading(false);
      }
    }
    void read();
    return () => {
      controller.abort();
      controllers.current.delete(controller);
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, photoId, contentsUpdatedAt, reload, adopt]);

  const run = ai?.run;
  useEffect(() => { setShowAccepted(false); }, [run?.id]);
  const accepted = run?.status === "accepted";
  const running = starting || pending(run);
  const stale = !!run && !accepted && (run.stale || run.photoId !== photoId || run.contentsUpdatedAt !== contentsUpdatedAt);
  const archived = !!detail.tote.archivedAt;
  const blocked = busy || accepting || reviewBusy || running || stale || archived || !!run?.dismissed;
  const existing = new Set(detail.items.map(item => normalizedName(item.name)));
  const selected = rows.filter(row => row.selected && !existing.has(normalizedName(row.name)));
  const oldPhoto = !!detail.tote.photo && new Date(contentsUpdatedAt) > new Date(detail.tote.photo.createdAt);
  function changeRow(id: string, change: Partial<DraftRow>) {
    setRows(previous => previous.map(row => row.id === id ? { ...row, ...change } : row));
    setError("");
  }

  async function analyze(force: boolean) {
    if (!photoId || busy || accepting || reviewBusy || running || archived || !ai?.enabled) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    revision.current++;
    setStarting(true);
    setError("");
    try {
      const next = await request<AIStateDTO>(endpoint, controller.signal, { photoId, contentsUpdatedAt, force });
      if (controller.signal.aborted || !alive.current) return;
      revision.current++;
      adopt(next);
      setReload(value => value + 1);
    } catch (issue) {
      if (!controller.signal.aborted && alive.current) setError(errorMessage(issue));
    } finally {
      controllers.current.delete(controller);
      if (alive.current) setStarting(false);
    }
  }

  async function updateReview(action: "dismiss" | "restore", suggestionId?: string) {
    if (!run || busy || accepting || reviewBusy || starting) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    revision.current++;
    setReviewBusy(true);
    setError("");
    try {
      const next = await request<AIStateDTO>(`${endpoint}/${action}`, controller.signal, { runId: run.id, ...(suggestionId ? { suggestionId } : {}) });
      if (controller.signal.aborted || !alive.current) return;
      revision.current++;
      adopt(next);
      setReload(value => value + 1);
    } catch (issue) {
      if (!controller.signal.aborted && alive.current) setError(errorMessage(issue));
    } finally {
      controllers.current.delete(controller);
      if (alive.current) setReviewBusy(false);
    }
  }

  async function accept() {
    if (blocked || run?.status !== "ready" || !selected.length) return;
    const names = new Set<string>();
    for (const row of selected) {
      const name = cleanName(row.name);
      if (!name || name.length > 200) {
        setError("Give each selected item a name of up to 200 characters.");
        return;
      }
      if (!validQuantity(row.quantity)) {
        setError("Use a whole-number quantity from 1 to 100,000 for each selected item.");
        return;
      }
      if (names.has(normalizedName(name))) {
        setError("Two selected suggestions have the same name. Rename one or uncheck it.");
        return;
      }
      names.add(normalizedName(name));
    }
    const controller = new AbortController();
    controllers.current.add(controller);
    revision.current++;
    setAccepting(true);
    setError("");
    heldBusy.current = true;
    busyCallback.current(true);
    try {
      const result = await request<{ detail: ToteDetailDTO; ai: AIStateDTO }>(`${endpoint}/accept`, controller.signal, {
        runId: run.id,
        items: selected.map(row => ({ suggestionId: row.id, name: cleanName(row.name), quantity: Number(row.quantity) })),
      });
      if (controller.signal.aborted || !alive.current) return;
      revision.current++;
      latestDetail.current = result.detail;
      adopt(result.ai);
      try {
        await onAdded(result.detail, selected.length);
      } catch {
        if (alive.current) setError("The items were added. Reload the page to refresh your inventory.");
      }
    } catch (issue) {
      if (!controller.signal.aborted && alive.current) setError(errorMessage(issue));
    } finally {
      controllers.current.delete(controller);
      if (alive.current) setAccepting(false);
      if (heldBusy.current) {
        heldBusy.current = false;
        busyCallback.current(false);
      }
    }
  }

  if (ai && !ai.enabled) return null;
  if (run?.dismissed || (accepted && !showAccepted)) return <section className="panel ai-panel ai-compact" aria-labelledby="ai-heading">
    <div className="ai-compact-heading"><h2 id="ai-heading"><Sparkles size={17} aria-hidden="true" />AI suggestions</h2><span className="ai-compact-status">{accepted ? `${run.acceptedCount} added` : pending(run) ? "Hidden · processing" : "Dismissed"}</span></div>
    <div className="ai-compact-actions">
      <Button variant="ghost" small loading={reviewBusy} disabled={busy || accepting || starting} onClick={() => run.dismissed ? void updateReview("restore") : setShowAccepted(true)}><ChevronDown size={15} aria-hidden="true" />{run.dismissed ? "Show suggestions" : "Show review"}</Button>
      <Button variant="ghost" small loading={starting} disabled={busy || accepting || reviewBusy || running || archived || !photoId} onClick={() => void analyze(true)}><RefreshCw size={14} aria-hidden="true" />Suggest again</Button>
    </div>
    {(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}
  </section>;
  return <section className="panel ai-panel" aria-labelledby="ai-heading">
    <div className="panel-heading">
      <h2 id="ai-heading"><Sparkles size={17} aria-hidden="true" />AI suggestions</h2>
      {run?.status === "ready" && !stale && <Badge muted>Review first</Badge>}
      {run?.status === "queued" && <Badge muted>Queued</Badge>}
      {run?.status === "running" && <Badge muted>Analyzing</Badge>}
      {accepted && <Badge><Check size={12} aria-hidden="true" />Saved</Badge>}
      {run && !accepted && <Button variant="ghost" small loading={reviewBusy} disabled={busy || accepting || starting} onClick={() => void updateReview("dismiss")}><X size={15} aria-hidden="true" />Dismiss all</Button>}
      {accepted && <Button variant="ghost" small onClick={() => setShowAccepted(false)}><ChevronUp size={15} aria-hidden="true" />Hide review</Button>}
    </div>
    <div className="panel-content ai-content">
      {loading && !ai ? <p className="ai-status" role="status"><LoaderCircle size={17} className="spinner" aria-hidden="true" />Loading suggestions...</p> : <>
        {!photoId ? <p className="ai-copy">Add a photo above. Suggestions will be prepared automatically.</p> : <>
          {!accepted && <p className="ai-copy">New photos are added to the suggestions queue automatically. Review the names and counts, then add the items you want to keep.</p>}
          {oldPhoto && !accepted && <p className="warning-note ai-warning">The contents changed after this photo. Update it for suggestions that match what's inside now.</p>}
          {running ? <div className="ai-progress" role="status">
            <LoaderCircle size={22} className="spinner" aria-hidden="true" />
            <div><strong>{starting ? "Adding photo to the queue..." : run?.status === "queued" ? `Waiting in the photo queue${run.queuePosition ? ` (position ${run.queuePosition})` : ""}...` : "Looking at your photo..."}</strong><p>{starting || run?.status === "queued" ? "Photos are processed one at a time. You can leave this tote and come back; the suggestions will be saved here." : "This can take a few minutes. You can leave this tote and come back; the suggestions will be saved here."}</p></div>
          </div> : <>
            {stale && <p className="warning-note ai-warning">This tote changed since these suggestions were made. Refresh suggestions before adding items.</p>}
            {run?.status === "failed" && <p className="form-error" role="alert">{run.error || "We could not make suggestions from this photo. Try again or add items yourself."}</p>}
            {accepted && <p className="ai-saved" role="status"><Check size={18} aria-hidden="true" />{run.acceptedCount.toLocaleString()} item {run.acceptedCount === 1 ? "type" : "types"} added to this tote.</p>}
            {accepted && <ul className="ai-reviewed-items">{run.suggestions.map(item => <li key={item.id}>{item.name}<span>Suggested quantity {item.quantity}</span></li>)}</ul>}
            {run?.status === "ready" && <>
              {rows.length ? <div className="ai-rows">{rows.map(row => {
                const alreadyListed = existing.has(normalizedName(row.name));
                const nameId = `ai-name-${row.id}`;
                const quantityId = `ai-quantity-${row.id}`;
                const noteId = `ai-note-${row.id}`;
                return <div className="ai-row" key={row.id} data-listed={alreadyListed || undefined}>
                  <label className="ai-select">
                    <input type="checkbox" checked={row.selected && !alreadyListed} disabled={blocked || alreadyListed} onChange={event => changeRow(row.id, { selected: event.target.checked })} aria-label={`Add ${row.name || "this suggested item"}`} />
                  </label>
                  <div className="ai-row-fields">
                    <div className="ai-edit-fields">
                      <div><label className="field-label" htmlFor={nameId}>Item name</label><Input id={nameId} value={row.name} maxLength={200} disabled={blocked} onChange={event => changeRow(row.id, { name: event.target.value })} aria-describedby={row.note && !alreadyListed ? noteId : undefined} /></div>
                      <div><label className="field-label" htmlFor={quantityId}>Quantity</label><Input id={quantityId} value={row.quantity} type="text" inputMode="numeric" pattern="[0-9]*" disabled={blocked || alreadyListed} onChange={event => changeRow(row.id, { quantity: event.target.value })} aria-invalid={!validQuantity(row.quantity)} aria-label={`Quantity of ${row.name || "suggested item"}`} /></div>
                    </div>
                    {alreadyListed ? <span className="ai-listed"><Check size={12} aria-hidden="true" />Already listed</span> : row.note ? <p className="ai-row-note" id={noteId}>{row.note}</p> : null}
                    <Button variant="ghost" small className="ai-dismiss-row" disabled={busy || accepting || reviewBusy} onClick={() => void updateReview("dismiss", row.id)} aria-label={`Dismiss suggestion ${row.name || "unnamed item"}`}><X size={14} aria-hidden="true" />Dismiss</Button>
                  </div>
                </div>;
              })}</div> : <p className="ai-copy">No items were suggested. Try a brighter photo from above, or add the items yourself.</p>}
            </>}
            <div className="ai-actions">
              {run?.status === "ready" && rows.length > 0 && <Button loading={accepting} disabled={blocked || !selected.length} onClick={() => void accept()}><Check size={16} aria-hidden="true" />Add selected ({selected.length})</Button>}
              {!!run?.dismissedSuggestionIds.length && <Button variant="ghost" small loading={reviewBusy} disabled={busy || accepting} onClick={() => void updateReview("restore")}>Restore dismissed ({run.dismissedSuggestionIds.length})</Button>}
              <Button variant={run?.status === "ready" && rows.length > 0 ? "ghost" : "secondary"} disabled={busy || accepting || reviewBusy || archived || !ai?.enabled} onClick={() => void analyze(!!run)}>
                {run ? <RefreshCw size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                {!run ? "Suggest items" : run.status === "failed" ? "Try again" : accepted ? "Suggest again" : stale ? "Refresh suggestions" : "Re-analyze photo"}
              </Button>
            </div>
          </>}
        </>}
        {archived && <p className="field-helper">Restore this tote to add suggestions.</p>}
      </>}
      {(error || loadError) && <div className="ai-error"><p className="form-error" role="alert">{error || loadError}</p>{error ? <Button variant="secondary" disabled={accepting} onClick={() => window.location.reload()}>Reload tote</Button> : <Button variant="secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>Retry loading</Button>}</div>}
    </div>
  </section>;
}
