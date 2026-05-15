import { SlidersHorizontal } from "lucide-react";

export default function GeneralPage() {
  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Bot configuration</p>
          <h2>General</h2>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">General</p>
            <h3>Agent settings</h3>
          </div>
          <SlidersHorizontal size={20} />
        </div>
        <p className="placeholder-copy">
          Agent-wide identity, behavior, and safety settings will live here.
        </p>
      </section>
    </>
  );
}
