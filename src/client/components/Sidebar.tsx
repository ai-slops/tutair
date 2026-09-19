import {
  BookOpen,
  Download,
  Menu,
  MessageSquarePlus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useRef } from "react";
import type { SearchResult, Thread } from "../model";
import { useFocusTrap } from "../useFocusTrap";
import type { SearchResponse } from "../workspace";

type SidebarProps = {
  readonly open: boolean;
  readonly titleQuery: string;
  readonly learningQuery: string;
  readonly threads: readonly Thread[];
  readonly search: {
    readonly results: readonly SearchResult[];
    readonly mode: SearchResponse["mode"] | null;
    readonly loading: boolean;
    readonly error: string | null;
  };
  readonly activeThreadId: string | null;
  readonly onClose: () => void;
  readonly onNew: () => void;
  readonly onTitleQuery: (query: string) => void;
  readonly onLearningQuery: (query: string) => void;
  readonly onSearch: () => void;
  readonly onSearchResult: (result: SearchResult) => void;
  readonly onSelect: (id: string) => void;
  readonly onSettings: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
};

export function Sidebar(props: SidebarProps) {
  const paneRef = useRef<HTMLElement>(null);
  useFocusTrap(props.open, paneRef, props.onClose, { mediaQuery: "(max-width: 45rem)" });
  const visibleThreads = props.threads.filter((thread) =>
    thread.title.toLocaleLowerCase().includes(props.titleQuery.toLocaleLowerCase()),
  );

  return (
    <aside
      ref={paneRef}
      className="thread-pane"
      data-open={props.open}
      aria-label="Learning threads"
    >
      <div className="pane-header">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen className="icon" aria-hidden="true" />
          </span>
          Tutair
        </div>
        <button
          className="icon-button mobile-only"
          type="button"
          onClick={props.onClose}
          aria-label="Close threads"
        >
          <X className="icon" />
        </button>
      </div>
      <div className="pane-content">
        <button className="button button-primary" type="button" onClick={props.onNew}>
          <MessageSquarePlus className="icon" />
          New conversation
        </button>
        <label className="search" style={{ marginBlockStart: "var(--space-4)" }}>
          <Search className="icon" aria-hidden="true" />
          <span className="sr-only">Filter thread titles</span>
          <input
            value={props.titleQuery}
            onChange={(event) => props.onTitleQuery(event.currentTarget.value)}
            placeholder="Filter thread titles"
          />
        </label>
        <nav className="thread-list" aria-label="Previous conversations">
          {visibleThreads.length === 0 ? (
            <p className="muted">
              {props.threads.length === 0
                ? "Your conversations will appear here."
                : "No conversations match that search."}
            </p>
          ) : null}
          {visibleThreads.map((thread) => (
            <button
              className="thread-row"
              type="button"
              key={thread.id}
              aria-current={thread.id === props.activeThreadId ? "page" : undefined}
              onClick={() => props.onSelect(thread.id)}
            >
              <span className="thread-row-title">{thread.title}</span>
              <time className="thread-row-meta" dateTime={thread.updatedAt}>
                {formatDate(thread.updatedAt)}
              </time>
            </button>
          ))}
        </nav>
        <div className="separator" />
        <form
          className="learning-search"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSearch();
          }}
        >
          <label className="search">
            <Search className="icon" aria-hidden="true" />
            <span className="sr-only">Search all learning</span>
            <input
              value={props.learningQuery}
              onChange={(event) => props.onLearningQuery(event.currentTarget.value)}
              placeholder="Search learning"
            />
          </label>
          <button
            className="button button-secondary"
            type="submit"
            disabled={props.search.loading || props.learningQuery.trim().length === 0}
          >
            {props.search.loading ? "Searching" : "Search"}
          </button>
        </form>
        <SearchResults search={props.search} onSelect={props.onSearchResult} />
        <div className="separator" />
        <div style={{ display: "grid", gap: "var(--space-2)", marginBlockStart: "var(--space-4)" }}>
          <button className="button button-secondary" type="button" onClick={props.onSettings}>
            <Settings className="icon" />
            Settings
          </button>
          <button className="button button-secondary" type="button" onClick={props.onExport}>
            <Download className="icon" />
            Export my learning
          </button>
          <button className="button button-danger" type="button" onClick={props.onDelete}>
            <Trash2 className="icon" />
            Delete all data
          </button>
        </div>
      </div>
    </aside>
  );
}

function SearchResults({
  search,
  onSelect,
}: {
  readonly search: SidebarProps["search"];
  readonly onSelect: (result: SearchResult) => void;
}) {
  if (search.error !== null) return <p className="muted">{search.error}</p>;
  if (search.mode === null) return null;
  if (search.results.length === 0) return <p className="muted">No learning records matched.</p>;
  return (
    <section className="search-results" aria-label="Learning search results">
      {search.results.map((result) => {
        const navigable = result.entityType === "thread" || result.entityType === "knowledge";
        const content = (
          <>
            <span className="thread-row-title">{result.title}</span>
            <span className="search-result-kind">{result.entityType}</span>
            <span className="search-result-summary">{result.statement}</span>
          </>
        );
        return navigable ? (
          <button
            className="search-result"
            type="button"
            key={`${result.entityType}-${result.id}`}
            onClick={() => onSelect(result)}
          >
            {content}
          </button>
        ) : (
          <article className="search-result" key={`${result.entityType}-${result.id}`}>
            {content}
          </article>
        );
      })}
    </section>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

export function ThreadsTrigger({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      className="icon-button mobile-only"
      type="button"
      onClick={onClick}
      aria-label="Open threads"
    >
      <Menu className="icon" />
    </button>
  );
}
