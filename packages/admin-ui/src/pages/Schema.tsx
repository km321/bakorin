import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getMeta, type MetaEntity, type MetaResponse } from "../lib/api.ts";
import { layoutSchema } from "../lib/schema-layout.ts";
import { metaToMermaid } from "../lib/schema-mermaid.ts";
import { layoutToSvg, readSchemaColors } from "../lib/schema-export.ts";
import { pushToast } from "../lib/toast.ts";

interface Props {
  initial: MetaResponse | null;
  onOpenEntity: (name: string) => void;
}

const ACTIONS = ["read", "create", "update", "delete"] as const;

function policyLines(entity: MetaEntity, action: (typeof ACTIONS)[number]): string {
  const list = entity.policies?.[action] ?? [];
  return list.length > 0 ? list.join(" or ") : "none";
}

export function Schema({ initial, onOpenEntity }: Props) {
  const [meta, setMeta] = useState<MetaResponse | null>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    setMeta(initial);
  }, [initial]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const next = await getMeta();
        if (!cancelled) {
          setMeta((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        }
      } catch {
        // keep the last good schema
      }
    }
    const timer = window.setInterval(() => void poll(), 2500);
    function onFocus() {
      void poll();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const layout = useMemo(() => {
    const layers = meta?.layers ?? [meta?.entities.map((entity) => entity.name) ?? []];
    const relations = (meta?.entities ?? []).flatMap((entity) =>
      entity.fields.flatMap((field) => {
        if (!field.relation) {
          return [];
        }
        return [
          {
            from: entity.name,
            field: field.name,
            to: field.relation.to,
            onDelete: field.relation.many ? "many" : (field.relation.onDelete ?? "restrict"),
          },
        ];
      }),
    );
    return layoutSchema(
      layers,
      (meta?.entities ?? []).map((entity) => ({ name: entity.name, fields: entity.fields })),
      relations,
    );
  }, [meta]);

  function fit() {
    const canvas = canvasRef.current;
    if (!canvas || layout.width === 0) {
      return;
    }
    const pad = 24;
    const scale = Math.min(
      (canvas.clientWidth - pad * 2) / layout.width,
      (canvas.clientHeight - pad * 2) / layout.height,
      1.15,
    );
    setView({
      scale,
      x: (canvas.clientWidth - layout.width * scale) / 2,
      y: Math.max(12, (canvas.clientHeight - layout.height * scale) / 2),
    });
  }

  useEffect(() => {
    if (layout.width > 0) {
      fit();
    }
  }, [layout.width, layout.height]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) {
      return;
    }
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      setView((current) => {
        const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
        const scale = Math.min(2.4, Math.max(0.35, current.scale * factor));
        const wx = (cx - current.x) / current.scale;
        const wy = (cy - current.y) / current.scale;
        return { scale, x: cx - wx * scale, y: cy - wy * scale };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const selectedEntity = meta?.entities.find((entity) => entity.name === selected) ?? null;
  const targeting =
    meta?.webhooks?.filter((hook) => hook.entity === selected || hook.entity === "*") ?? [];

  function zoom(factor: number) {
    setView((current) => ({ ...current, scale: Math.min(2.4, Math.max(0.35, current.scale * factor)) }));
  }

  async function copyMermaid() {
    if (!meta) {
      return;
    }
    try {
      await navigator.clipboard.writeText(metaToMermaid(meta));
      pushToast("ok", "Mermaid copied");
    } catch {
      pushToast("error", "Could not copy");
    }
  }

  function downloadSvg() {
    if (!meta || !canvasRef.current) {
      return;
    }
    const svg = layoutToSvg(layout, meta.entities, readSchemaColors(document.documentElement));
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${meta.app.name}-schema.svg`;
    link.click();
    URL.revokeObjectURL(url);
    pushToast("ok", "SVG downloaded");
  }

  return (
    <>
      <div class="toolbar">
        <div>
          <h1>Schema</h1>
          <div class="muted">Entities and relations from this project&apos;s app.yaml.</div>
        </div>
        <div class="schema-tools">
          <button class="btn secondary schema-zoom" type="button" onClick={() => zoom(1 / 1.15)} aria-label="Zoom out">
            -
          </button>
          <button class="btn secondary schema-zoom" type="button" onClick={() => zoom(1.15)} aria-label="Zoom in">
            +
          </button>
          <button class="btn secondary schema-zoom" type="button" onClick={() => fit()}>
            Fit
          </button>
          <button class="btn secondary" type="button" onClick={() => downloadSvg()}>
            Download SVG
          </button>
          <button class="btn secondary" type="button" onClick={() => void copyMermaid()}>
            Copy as Mermaid
          </button>
        </div>
      </div>

      {!meta ? <p class="muted schema-empty">Loading schema.</p> : null}
      {meta && meta.entities.length === 0 ? (
        <p class="muted schema-empty">No entities in this project yet.</p>
      ) : null}

      <div
        class="schema-canvas"
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Schema diagram. Drag to pan, wheel to zoom."
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest(".schema-card")) {
            return;
          }
          drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
          (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) {
            return;
          }
          setView({
            ...view,
            x: drag.current.vx + (event.clientX - drag.current.x),
            y: drag.current.vy + (event.clientY - drag.current.y),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoom(1.15);
          } else if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            zoom(1 / 1.15);
          } else if (event.key === "0") {
            event.preventDefault();
            fit();
          } else if (event.key === "Escape") {
            setSelected(null);
          } else if (event.key === "ArrowLeft") {
            setView((current) => ({ ...current, x: current.x + 24 }));
          } else if (event.key === "ArrowRight") {
            setView((current) => ({ ...current, x: current.x - 24 }));
          } else if (event.key === "ArrowUp") {
            setView((current) => ({ ...current, y: current.y + 24 }));
          } else if (event.key === "ArrowDown") {
            setView((current) => ({ ...current, y: current.y - 24 }));
          }
        }}
      >
        <div
          class="schema-world"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <svg class="schema-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="schema-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
              </marker>
            </defs>
            {layout.edges.map((edge) =>
              edge.d ? (
                <g key={`${edge.from}-${edge.field}-${edge.to}`}>
                  <path d={edge.d} fill="none" stroke="currentColor" stroke-width="1.4" marker-end="url(#schema-arrow)" />
                  <text x={edge.labelX} y={edge.labelY} text-anchor="middle">
                    {edge.field} {edge.onDelete}
                  </text>
                </g>
              ) : null,
            )}
          </svg>
          {layout.nodes.map((node) => {
            const entity = meta?.entities.find((item) => item.name === node.name);
            if (!entity) {
              return null;
            }
            return (
              <button
                key={node.name}
                type="button"
                class={selected === node.name ? "schema-card selected" : "schema-card"}
                style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                aria-pressed={selected === node.name}
                onClick={() => setSelected(node.name)}
              >
                <header>
                  <strong>{entity.label}</strong>
                  <span>{entity.name}{entity.auth ? " · auth" : ""}</span>
                </header>
                <ul>
                  {entity.fields.map((field) => (
                    <li key={field.name} class={field.relation ? "rel" : field.secret ? "secret" : ""}>
                      <span>
                        {field.name}
                        {field.required ? <abbr title="Required">*</abbr> : null}
                        {field.unique ? <abbr title="Unique">U</abbr> : null}
                      </span>
                      <em>{field.secret ? "hidden" : field.type}</em>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      </div>

      <ul class="schema-list" aria-label="Entities">
        {(meta?.entities ?? []).map((entity) => (
          <li key={entity.name}>
            <button
              type="button"
              class={selected === entity.name ? "active" : ""}
              onClick={() => setSelected(entity.name)}
            >
              <strong>{entity.label}</strong>
              <span class="muted">{entity.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {selectedEntity ? (
        <aside class="schema-panel" aria-label={`${selectedEntity.label} details`}>
          <div class="schema-panel-head">
            <div>
              <h2>{selectedEntity.label}</h2>
              <div class="muted">{selectedEntity.name}</div>
            </div>
            <button class="btn secondary" type="button" onClick={() => setSelected(null)} aria-label="Close details">
              Close
            </button>
          </div>
          <p>{selectedEntity.description ?? "No description on this entity."}</p>
          <h3>Policies</h3>
          <dl class="schema-dl">
            {ACTIONS.map((action) => (
              <div key={action}>
                <dt>{action}</dt>
                <dd class="mono">{policyLines(selectedEntity, action)}</dd>
              </div>
            ))}
          </dl>
          <h3>Indexes</h3>
          {selectedEntity.indexes && selectedEntity.indexes.length > 0 ? (
            <ul class="schema-indexes">
              {selectedEntity.indexes.map((index) => (
                <li key={index.join(",")} class="mono">
                  {index.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted">No extra indexes.</p>
          )}
          <h3>Fields</h3>
          <ul class="schema-fields">
            {selectedEntity.fields.map((field) => (
              <li key={field.name}>
                <strong>
                  {field.name}
                  {field.required ? "*" : ""}
                </strong>
                <span class="muted">
                  {field.secret ? "hidden" : field.type}
                  {field.relation ? ` to ${field.relation.to} (${field.relation.many ? "many" : (field.relation.onDelete ?? "restrict")})` : ""}
                </span>
                <p>{field.description ?? "No field description."}</p>
              </li>
            ))}
          </ul>
          <h3>Webhooks</h3>
          {targeting.length > 0 ? (
            <ul class="schema-indexes">
              {targeting.map((hook) => (
                <li key={hook.id} class="mono">
                  {hook.id}: {hook.entity} {hook.events.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted">No webhooks target this entity.</p>
          )}
          <button
            class="btn"
            type="button"
            onClick={() => {
              setSelected(null);
              onOpenEntity(selectedEntity.name);
            }}
          >
            Open {selectedEntity.plural} table
          </button>
        </aside>
      ) : null}
    </>
  );
}
