export function WorkspaceLoading() {
  return (
    <div className="app-shell">
      <main className="workspace-loading" aria-busy="true">
        <div className="notice">
          <span className="spinner" aria-hidden="true" />
          <strong>Opening learning workspace</strong>
        </div>
      </main>
    </div>
  );
}
