"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  MousePointer,
  Keyboard,
  MousePointerClick,
  Monitor,
  List,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface TrackingEvent {
  id: string;
  eventType: string;
  dataJson: any;
  timestamp: string;
}

interface Snapshot {
  id: string;
  path: string;
  html: string;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  timestamp: string;
  ts: number;
}

interface FlatEvent {
  t: string;
  x?: number;
  y?: number;
  sx?: number;
  sy?: number;
  vw?: number;
  vh?: number;
  el?: string;
  cls?: string;
  field?: string;
  val?: string;
  name?: string;
  id?: string;
  tag?: string;
  type?: string;
  sel?: string;
  ts: number;
}

interface Metrics {
  fps: number;
  droppedFrames: number;
  backlog: number;
}

interface Props {
  events: TrackingEvent[];
  sessionId: string;
}

const SCRUBBER_STEP = 0.1;
const UI_TICK_MS = 120;
const SNAPSHOT_COALESCE_MS = 650;
const ADMIN_SNAPSHOT_COALESCE_MS = 1200;
const ADMIN_PATH_RE = /\/wp-admin\b/i;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeSelectorValue(value: string) {
  return value.replace(/"/g, "").slice(0, 120);
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function compareSnapshotOrder(a: Snapshot, b: Snapshot) {
  if (a.ts !== b.ts) return a.ts - b.ts;
  try {
    const aid = BigInt(a.id);
    const bid = BigInt(b.id);
    if (aid < bid) return -1;
    if (aid > bid) return 1;
  } catch {
    // fallback if id is not bigint-compatible
  }
  return a.id.localeCompare(b.id);
}

export default function SessionReplay({ events, sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const clickRingRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLInputElement>(null);
  const animRef = useRef<number>(0);

  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [activeSnap, setActiveSnap] = useState<Snapshot | null>(null);
  const [, setSnapIdx] = useState(0);
  const [loadingSnap, setLoadingSnap] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentTs, setCurrentTs] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [typedFields, setTypedFields] = useState<Record<string, string>>({});
  const [stats, setStats] = useState({ mouse: 0, clicks: 0, keys: 0 });
  const [metrics, setMetrics] = useState<Metrics>({ fps: 0, droppedFrames: 0, backlog: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  const timelineRef = useRef<{
    events: FlatEvent[];
    snapshots: Snapshot[];
    duration: number;
  }>({ events: [], snapshots: [], duration: 0 });

  const playbackRef = useRef({
    playing: false,
    time: 0,
    lastFrame: 0,
    lastUiTick: 0,
    eventIndex: 0,
    snapshotIndex: 0,
    lastSnapshotId: "",
    lastScroll: { x: 0, y: 0 },
    lastScrollAppliedAt: 0,
  });

  const mouseRef = useRef<{ prev?: FlatEvent; curr?: FlatEvent }>({});
  const typedRef = useRef<Record<string, string>>({});
  const metricsRef = useRef({ frames: 0, dropped: 0, lastReport: 0 });
  const cursorPosRef = useRef<{ x: number; y: number; vw: number; vh: number } | null>(null);

  useEffect(() => {
    fetch(`/api/snapshots?sessionId=${sessionId}`)
      .then((r) => r.json())
      .then((data: Snapshot[]) => {
        setSnapshots(data);
        if (data.length > 0) {
          setActiveSnap(data[0]);
          setSnapIdx(0);
        }
        setLoadingSnap(false);
      })
      .catch(() => setLoadingSnap(false));
  }, [sessionId]);

  const applySnapshot = useCallback(
    (snap: Snapshot, force = false) => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      const state = playbackRef.current;
      if (!force && state.lastSnapshotId === snap.id) {
        return;
      }

      const doc = iframe.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(snap.html);
      doc.close();

      try {
        iframe.contentWindow?.scrollTo(snap.scrollX, snap.scrollY);
      } catch {
        // ignore sandbox edge cases
      }

      state.lastScroll = { x: snap.scrollX, y: snap.scrollY };
      state.lastScrollAppliedAt = performance.now();
      state.lastSnapshotId = snap.id;
      setActiveSnap(snap);
    },
    []
  );

  useEffect(() => {
    if (activeSnap && playbackRef.current.lastSnapshotId !== activeSnap.id) {
      applySnapshot(activeSnap, true);
    }
  }, [activeSnap, applySnapshot]);

  useEffect(() => {
    const flat: FlatEvent[] = [];
    let st = { mouse: 0, clicks: 0, keys: 0 };
    for (const ev of events) {
      if (ev.eventType === "batch" && Array.isArray(ev.dataJson)) {
        for (const e of ev.dataJson) {
          const item = e as FlatEvent;
          if (!item.ts) item.ts = new Date(ev.timestamp).getTime();
          flat.push(item);
          if (e.t === "mouse") st.mouse++;
          else if (e.t === "click") st.clicks++;
          else if (e.t === "key") st.keys++;
        }
      } else if (ev.dataJson && typeof ev.dataJson === "object") {
        const data = ev.dataJson as FlatEvent;
        const item: FlatEvent = {
          ...data,
          t: data.t || ev.eventType,
          ts: data.ts || new Date(ev.timestamp).getTime(),
        };
        flat.push(item);
        if (item.t === "mouse") st.mouse++;
        else if (item.t === "click") st.clicks++;
        else if (item.t === "key") st.keys++;
      }
    }
    flat.sort((a, b) => a.ts - b.ts);

    const mouseCoalesced: FlatEvent[] = [];
    let lastMouse: FlatEvent | undefined;
    let lastScroll: FlatEvent | undefined;
    for (const ev of flat) {
      if (ev.t === "mouse") {
        if (!lastMouse) {
          mouseCoalesced.push(ev);
          lastMouse = ev;
          continue;
        }
        const dt = ev.ts - lastMouse.ts;
        const dx = Math.abs((ev.x || 0) - (lastMouse.x || 0));
        const dy = Math.abs((ev.y || 0) - (lastMouse.y || 0));
        if (dt >= 8 || dx + dy >= 2) {
          mouseCoalesced.push(ev);
          lastMouse = ev;
        }
        continue;
      }
      if (ev.t === "scroll") {
        if (!lastScroll) {
          mouseCoalesced.push(ev);
          lastScroll = ev;
          continue;
        }
        const dt = ev.ts - lastScroll.ts;
        const dx = Math.abs((ev.x || 0) - (lastScroll.x || 0));
        const dy = Math.abs((ev.y || 0) - (lastScroll.y || 0));
        if (dt >= 30 || dx + dy >= 4) {
          mouseCoalesced.push(ev);
          lastScroll = ev;
        }
        continue;
      }
      mouseCoalesced.push(ev);
    }

    const sortedSnaps = snapshots.slice().sort(compareSnapshotOrder);
    const snaps: Snapshot[] = [];
    for (const snap of sortedSnaps) {
      const prev = snaps[snaps.length - 1];
      if (!prev) {
        snaps.push(snap);
        continue;
      }
      const coalesceMs = ADMIN_PATH_RE.test(snap.path) ? ADMIN_SNAPSHOT_COALESCE_MS : SNAPSHOT_COALESCE_MS;
      const closeInTime = snap.ts - prev.ts <= coalesceMs;
      const samePath = snap.path === prev.path;
      const sameViewport = snap.viewportWidth === prev.viewportWidth && snap.viewportHeight === prev.viewportHeight;
      const sameScroll = snap.scrollX === prev.scrollX && snap.scrollY === prev.scrollY;
      if (closeInTime && samePath && sameViewport && sameScroll) {
        continue;
      }
      snaps.push(snap);
    }
    const startCandidate = Math.min(
      mouseCoalesced.length ? mouseCoalesced[0].ts : Number.POSITIVE_INFINITY,
      snaps.length ? snaps[0].ts : Number.POSITIVE_INFINITY
    );
    const start = Number.isFinite(startCandidate) ? startCandidate : 0;
    const end = Math.max(
      mouseCoalesced.length ? mouseCoalesced[mouseCoalesced.length - 1].ts : 0,
      snaps.length ? snaps[snaps.length - 1].ts : 0
    );

    const normalizedEvents = mouseCoalesced.map((e) => ({ ...e, ts: e.ts - start }));
    const normalizedSnaps = snaps.map((s) => ({ ...s, ts: s.ts - start }));

    timelineRef.current = {
      events: normalizedEvents,
      snapshots: normalizedSnaps,
      duration: Math.max(0, end - start),
    };

    playbackRef.current.time = 0;
    playbackRef.current.eventIndex = 0;
    playbackRef.current.snapshotIndex = 0;
    mouseRef.current = {};
    typedRef.current = {};
    setTypedFields({});
    setCurrentTs(0);
    setTotalDuration(Math.max(0, end - start));
    setStats(st);
  }, [events, snapshots]);

  const applyInputToIframe = useCallback((ev: FlatEvent) => {
    if (!ev.val || ev.val === "[REDACTED]") return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    let target: HTMLInputElement | HTMLTextAreaElement | null = null;
    if (ev.sel) {
      target = doc.querySelector(ev.sel) as HTMLInputElement | HTMLTextAreaElement | null;
    }
    if (!target && ev.id) {
      target = doc.getElementById(ev.id) as HTMLInputElement | HTMLTextAreaElement | null;
    }
    if (!target && ev.name) {
      target = doc.querySelector(`[name="${safeSelectorValue(ev.name)}"]`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
    }
    if (!target && ev.tag) {
      target = doc.querySelector(ev.tag) as HTMLInputElement | HTMLTextAreaElement | null;
    }

    if (target && "value" in target) {
      try {
        target.value = ev.val || "";
      } catch {
        // ignore DOM sync issues
      }
    }
  }, []);

  const moveCursor = useCallback(
    (clientX: number, clientY: number, origVw: number, origVh: number, isClick: boolean) => {
      const wrapper = iframeRef.current?.parentElement;
      if (!wrapper || !cursorRef.current) return;
      const cw = wrapper.clientWidth;
      const ch = wrapper.clientHeight;
      const safeVw = Math.max(1, origVw || cw || 1);
      const safeVh = Math.max(1, origVh || ch || 1);
      const clampedX = clamp(clientX, 0, safeVw);
      const clampedY = clamp(clientY, 0, safeVh);
      const scale = Math.min(cw / safeVw, ch / safeVh);
      const renderedW = safeVw * scale;
      const renderedH = safeVh * scale;
      const offsetX = (cw - renderedW) / 2;
      const offsetY = (ch - renderedH) / 2;
      const px = offsetX + clampedX * scale;
      const py = offsetY + clampedY * scale;
      cursorPosRef.current = { x: clampedX, y: clampedY, vw: safeVw, vh: safeVh };
      cursorRef.current.style.transform = `translate(${px - 8}px, ${py - 4}px)`;

      if (isClick && clickRingRef.current) {
        const ring = clickRingRef.current;
        ring.style.transform = `translate(${px - 16}px, ${py - 16}px) scale(0.5)`;
        ring.style.opacity = "1";
        requestAnimationFrame(() => {
          ring.style.transition = "transform 0.4s ease-out, opacity 0.4s ease-out";
          ring.style.transform = `translate(${px - 16}px, ${py - 16}px) scale(2)`;
          ring.style.opacity = "0";
        });
        setTimeout(() => {
          if (ring) {
            ring.style.transition = "none";
            ring.style.opacity = "0";
          }
        }, 420);
      }
    },
    []
  );

  const applyScroll = useCallback((scrollX: number, scrollY: number) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.scrollTo(scrollX, scrollY);
    } catch {
      // ignore sandbox edge cases
    }
  }, []);

  const renderInterpolatedMouse = useCallback(
    (ts: number) => {
      const prev = mouseRef.current.prev;
      const curr = mouseRef.current.curr;
      if (!prev || !curr) return;

      const t0 = prev.ts;
      const t1 = curr.ts;
      if (t1 <= t0) return;

      const ratio = clamp((ts - t0) / (t1 - t0), 0, 1);
      const x = (prev.x || 0) + ((curr.x || 0) - (prev.x || 0)) * ratio;
      const y = (prev.y || 0) + ((curr.y || 0) - (prev.y || 0)) * ratio;
      const vw = curr.vw || prev.vw || activeSnap?.viewportWidth || 1280;
      const vh = curr.vh || prev.vh || activeSnap?.viewportHeight || 720;
      moveCursor(x, y, vw, vh, false);
    },
    [activeSnap, moveCursor]
  );

  const processEvent = useCallback(
    (ev: FlatEvent) => {
      if (ev.t === "mouse") {
        mouseRef.current.prev = mouseRef.current.curr || ev;
        mouseRef.current.curr = ev;
        return;
      }
      if (ev.t === "click") {
        const vw = ev.vw || activeSnap?.viewportWidth || 1280;
        const vh = ev.vh || activeSnap?.viewportHeight || 720;
        if (typeof ev.x === "number" && typeof ev.y === "number") {
          moveCursor(ev.x, ev.y, vw, vh, true);
        }
        return;
      }
      if (ev.t === "scroll") {
        playbackRef.current.lastScroll = { x: ev.x ?? ev.sx ?? 0, y: ev.y ?? ev.sy ?? 0 };
        return;
      }
      if (ev.t === "key") {
        if (ev.field && ev.val !== undefined) {
          typedRef.current = { ...typedRef.current, [ev.field]: ev.val || "" };
          setTypedFields({ ...typedRef.current });
          applyInputToIframe(ev);
        }
      }
    },
    [activeSnap, applyInputToIframe, moveCursor]
  );

  const syncSnapshotToTime = useCallback(
    (ts: number) => {
      const snaps = timelineRef.current.snapshots;
      if (!snaps.length) return;

      let idx = playbackRef.current.snapshotIndex;
      if (idx >= snaps.length) idx = snaps.length - 1;
      while (idx + 1 < snaps.length && snaps[idx + 1].ts <= ts) idx += 1;
      while (idx > 0 && snaps[idx].ts > ts) idx -= 1;

      if (idx !== playbackRef.current.snapshotIndex) {
        playbackRef.current.snapshotIndex = idx;
        setSnapIdx(idx);
        applySnapshot(snaps[idx]);
      }
    },
    [applySnapshot]
  );

  const tick = useCallback(
    (rafNow: number) => {
      if (!playbackRef.current.playing) return;

      const state = playbackRef.current;
      const timeline = timelineRef.current;
      const delta = (rafNow - state.lastFrame) * speed;
      state.lastFrame = rafNow;

      if (delta > 60) {
        metricsRef.current.dropped += 1;
      }

      state.time = clamp(state.time + delta, 0, timeline.duration);
      const targetTime = state.time;

      while (state.eventIndex < timeline.events.length && timeline.events[state.eventIndex].ts <= targetTime) {
        processEvent(timeline.events[state.eventIndex]);
        state.eventIndex += 1;
      }

      renderInterpolatedMouse(targetTime);
      syncSnapshotToTime(targetTime);

      const scrollNow = performance.now();
      if (scrollNow - state.lastScrollAppliedAt > 40) {
        state.lastScrollAppliedAt = scrollNow;
        applyScroll(state.lastScroll.x, state.lastScroll.y);
      }

      if (rafNow - state.lastUiTick > UI_TICK_MS) {
        state.lastUiTick = rafNow;
        setCurrentTs(targetTime);
      }

      metricsRef.current.frames += 1;

      const now = performance.now();
      if (now - metricsRef.current.lastReport >= 1000) {
        const deltaMs = now - (metricsRef.current.lastReport || now);
        const fps = deltaMs > 0
          ? Math.round((metricsRef.current.frames * 1000) / deltaMs)
          : metricsRef.current.frames;
        const backlog = Math.max(0, timeline.events.length - state.eventIndex);
        setMetrics({
          fps,
          droppedFrames: metricsRef.current.dropped,
          backlog,
        });
        metricsRef.current.frames = 0;
        metricsRef.current.dropped = 0;
        metricsRef.current.lastReport = now;
      }

      if (targetTime >= timeline.duration) {
        playbackRef.current.playing = false;
        setPlaying(false);
        return;
      }

      animRef.current = requestAnimationFrame(tick);
    },
    [applyScroll, processEvent, renderInterpolatedMouse, speed, syncSnapshotToTime]
  );

  useEffect(() => {
    if (!playing) {
      playbackRef.current.playing = false;
      cancelAnimationFrame(animRef.current);
      return;
    }

    playbackRef.current.playing = true;
    playbackRef.current.lastFrame = performance.now();
    playbackRef.current.lastUiTick = 0;
    metricsRef.current.frames = 0;
    metricsRef.current.dropped = 0;
    metricsRef.current.lastReport = performance.now();
    animRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animRef.current);
  }, [playing, tick]);

  const rebuildStateTo = useCallback(
    (ts: number) => {
      const timeline = timelineRef.current;
      const state = playbackRef.current;
      state.time = ts;
      state.eventIndex = 0;
      state.snapshotIndex = 0;
      typedRef.current = {};
      setTypedFields({});
      mouseRef.current = {};
      state.lastScroll = { x: 0, y: 0 };

      while (state.snapshotIndex + 1 < timeline.snapshots.length && timeline.snapshots[state.snapshotIndex + 1].ts <= ts) {
        state.snapshotIndex += 1;
      }
      if (timeline.snapshots[state.snapshotIndex]) {
        setSnapIdx(state.snapshotIndex);
        applySnapshot(timeline.snapshots[state.snapshotIndex], true);
      }

      while (state.eventIndex < timeline.events.length && timeline.events[state.eventIndex].ts <= ts) {
        processEvent(timeline.events[state.eventIndex]);
        state.eventIndex += 1;
      }

      renderInterpolatedMouse(ts);
      applyScroll(state.lastScroll.x, state.lastScroll.y);
      setCurrentTs(ts);
    },
    [applyScroll, applySnapshot, processEvent, renderInterpolatedMouse]
  );

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const pct = parseFloat(e.target.value) / 100;
    const ts = pct * totalDuration;
    rebuildStateTo(ts);
  }

  function reset() {
    cancelAnimationFrame(animRef.current);
    playbackRef.current.playing = false;
    setPlaying(false);
    rebuildStateTo(0);
  }

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }

  useEffect(() => {
    const reprojectCursor = () => {
      const pos = cursorPosRef.current;
      if (!pos) return;
      moveCursor(pos.x, pos.y, pos.vw, pos.vh, false);
    };
    const handler = () => {
      setFullscreen(!!document.fullscreenElement);
      requestAnimationFrame(reprojectCursor);
    };
    const resizeHandler = () => requestAnimationFrame(reprojectCursor);
    window.addEventListener("resize", resizeHandler);
    document.addEventListener("fullscreenchange", handler);
    return () => {
      window.removeEventListener("resize", resizeHandler);
      document.removeEventListener("fullscreenchange", handler);
    };
  }, [moveCursor]);

  const hasBehavior = timelineRef.current.events.length > 0;
  const timelineSnapshots = timelineRef.current.snapshots;
  const progress = totalDuration > 0 ? (currentTs / totalDuration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="bg-card border border-border rounded-xl overflow-hidden"
      style={fullscreen ? { background: "#0a0e14" } : {}}
    >
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest flex items-center gap-2">
          <Monitor className="w-4 h-4 text-primary" />
          Session Replay
        </h2>
        <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <MousePointer className="w-3 h-3" />{stats.mouse}
          </span>
          <span className="flex items-center gap-1">
            <MousePointerClick className="w-3 h-3" />{stats.clicks}
          </span>
          <span className="flex items-center gap-1">
            <Keyboard className="w-3 h-3" />{stats.keys}
          </span>
          {activeSnap && (
            <span className="text-primary font-medium">
              {activeSnap.viewportWidth}×{activeSnap.viewportHeight}
            </span>
          )}
          <span className="text-muted-foreground">
            {formatTime(Math.max(0, currentTs))} / {formatTime(totalDuration)}
          </span>
          <span className="text-muted-foreground">
            FPS {metrics.fps} · Dropped {metrics.droppedFrames} · Queue {metrics.backlog}
          </span>
        </div>
      </div>

      {timelineSnapshots.length > 1 && (
        <div className="flex items-center gap-1 px-5 py-2 border-b border-border overflow-x-auto">
          <List className="w-3 h-3 text-muted-foreground shrink-0 mr-1" />
          {timelineSnapshots.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                rebuildStateTo(s.ts);
              }}
              className={`px-3 py-1 rounded text-xs font-mono whitespace-nowrap transition-all ${
                activeSnap?.id === s.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.path.length > 24 ? s.path.slice(0, 24) + "…" : s.path}
            </button>
          ))}
        </div>
      )}

      {loadingSnap ? (
        <div className="p-12 text-center text-sm text-muted-foreground">Loading snapshot…</div>
      ) : !activeSnap ? (
        <div className="p-12 text-center space-y-2 text-sm text-muted-foreground">
          <p>No page snapshot recorded for this session.</p>
          <p className="text-xs opacity-60">Snapshots are captured when a visitor loads a page through the proxy.</p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div
            className="relative rounded-lg overflow-hidden border border-border bg-white mx-auto"
            style={{
              width: "100%",
              aspectRatio: `${activeSnap.viewportWidth} / ${activeSnap.viewportHeight}`,
              maxHeight: fullscreen ? "calc(100vh - 220px)" : "520px",
            }}
          >
            <iframe
              ref={iframeRef}
              sandbox="allow-same-origin"
              className="w-full h-full border-0 pointer-events-none select-none"
              title="Session Replay"
              style={{ display: "block" }}
            />

            <div
              ref={cursorRef}
              className="absolute top-0 left-0 pointer-events-none z-50"
              style={{
                transform: "translate(-20px,-20px)",
                willChange: "transform",
                transition: "none",
              }}
            >
              <MousePointer className="w-5 h-5 text-red-500 drop-shadow-lg" />
            </div>

            <div
              ref={clickRingRef}
              className="absolute top-0 left-0 pointer-events-none z-40 w-8 h-8 rounded-full border-2 border-red-500 opacity-0"
              style={{ willChange: "transform, opacity", transition: "none" }}
            />

            {Object.keys(typedFields).length > 0 && (
              <div className="absolute bottom-3 left-3 z-50 pointer-events-none" style={{ maxWidth: "280px" }}>
                <div className="bg-black/80 backdrop-blur-sm border border-primary/30 rounded-lg px-3 py-2 space-y-1">
                  <div className="text-xs text-primary font-mono uppercase tracking-widest mb-1 flex items-center gap-1">
                    <Keyboard className="w-3 h-3" /> Captured Input
                  </div>
                  {Object.entries(typedFields).map(([field, val]) => (
                    <div key={field} className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-muted-foreground truncate" style={{ maxWidth: 80 }}>{field}:</span>
                      <span className="text-primary bg-primary/10 px-1.5 py-0.5 rounded truncate" style={{ maxWidth: 140 }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!hasBehavior && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                <p className="text-white text-sm font-mono bg-black/60 px-4 py-2 rounded-lg">
                  Snapshot available — no mouse events recorded
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <input
              ref={scrubberRef}
              type="range"
              min={0}
              max={100}
              step={SCRUBBER_STEP}
              value={Math.min(100, Math.max(0, progress))}
              onChange={handleScrub}
              disabled={!hasBehavior}
              className="w-full h-2 rounded-full appearance-none cursor-pointer disabled:opacity-30"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) ${progress}%, hsl(var(--secondary)) ${progress}%)`,
                outline: "none",
              }}
            />
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{formatTime(Math.max(0, currentTs))}</span>
              <span>{formatTime(totalDuration)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                if (!playing && currentTs >= totalDuration) reset();
                setPlaying((p) => !p);
              }}
              disabled={!hasBehavior}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {playing ? "Pause" : "Play"}
            </button>

            <button
              onClick={reset}
              className="flex items-center gap-2 bg-secondary text-muted-foreground px-4 py-2 rounded-lg text-sm font-medium hover:text-foreground transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>

            <div className="flex items-center gap-1">
              {[0.5, 1, 2, 4].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`text-xs font-mono px-2 py-1.5 rounded transition-all ${
                    speed === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            <button
              onClick={toggleFullscreen}
              className="ml-auto flex items-center gap-2 bg-secondary text-muted-foreground px-3 py-2 rounded-lg text-sm hover:text-foreground transition-all"
              title="Toggle fullscreen"
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
