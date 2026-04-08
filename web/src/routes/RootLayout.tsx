import { useCallback, useState, useRef, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { InstallBanner } from "@/components/shared/InstallBanner";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { MainWalkthrough } from "@/components/shared/MainWalkthrough";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { PanelLeftOpen } from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 280;
const LS_KEY_WIDTH = "nanth-sidebar-width";
const LS_KEY_COLLAPSED = "nanth-sidebar-collapsed";

function readStoredWidth(): number {
  try {
    const v = localStorage.getItem(LS_KEY_WIDTH);
    if (v) return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(v)));
  } catch { /* */ }
  return SIDEBAR_DEFAULT;
}

function readStoredCollapsed(): boolean {
  try { return localStorage.getItem(LS_KEY_COLLAPSED) === "true"; } catch { return false; }
}

/**
 * Root layout for all /app/* routes.
 *
 * Desktop (md+): resizable sidebar (chat list) + right pane (chat or empty state)
 * Mobile (<md): full-screen chat list drawer; detail pages can reopen it
 */
export function RootLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  // ── Sidebar state ───────────────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const [isCollapsed, setIsCollapsed] = useState(readStoredCollapsed);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  // Persist width
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_WIDTH, String(sidebarWidth)); } catch { /* */ }
  }, [sidebarWidth]);

  // Persist collapsed
  useEffect(() => {
    try { localStorage.setItem(LS_KEY_COLLAPSED, String(isCollapsed)); } catch { /* */ }
  }, [isCollapsed]);

  const toggleCollapse = useCallback(() => setIsCollapsed((v) => !v), []);
  const closeMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);
  const handleResizeHandleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isCollapsed) return;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSidebarWidth((w) => Math.max(SIDEBAR_MIN, w - 20));
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      setSidebarWidth((w) => Math.min(SIDEBAR_MAX, w + 20));
    }

    if (e.key === "Home") {
      e.preventDefault();
      setSidebarWidth(SIDEBAR_MIN);
    }

    if (e.key === "End") {
      e.preventDefault();
      setSidebarWidth(SIDEBAR_MAX);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const isRootAppPath = location.pathname === "/app" || location.pathname === "/app/";
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    if (!isMobile) {
      const timer = window.setTimeout(() => setIsMobileSidebarOpen(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setIsMobileSidebarOpen(isRootAppPath), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [location.pathname]);

  // ── Drag resize ─────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setIsResizing(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartWidth.current + delta));
      setSidebarWidth(next);
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  const handleNewChat = useCallback(() => void navigate("/app/chat"), [navigate]);
  const handleCloseChat = useCallback(() => void navigate("/app"), [navigate]);

  useKeyboardShortcuts({
    onNewChat: handleNewChat,
    onCloseChat: handleCloseChat,
    onToggleSidebar: toggleCollapse,
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsMobileSidebarOpen(false);
      }
      if (isCollapsed) return;
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setSidebarWidth((w) => Math.max(SIDEBAR_MIN, w - 20));
      }
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        setSidebarWidth((w) => Math.min(SIDEBAR_MAX, w + 20));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCollapsed]);

  return (
    <div className="flex min-h-dvh h-dvh bg-background overflow-hidden">
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t("chat_list_aria")}>
          <div className="absolute inset-0 bg-black/40" onClick={closeMobileSidebar} />
          <div className="relative h-full bg-background">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Desktop sidebar — resizable chat list panel */}
      <aside
        className="hidden md:flex flex-shrink-0 h-full relative"
        style={{ width: isCollapsed ? 0 : sidebarWidth, transition: isResizing ? "none" : "width 200ms ease" }}
        aria-label={t("chat_list_aria")}
      >
        {!isCollapsed && (
          <>
            <div className="h-full w-full p-3 pr-1.5">
              <Sidebar onToggleCollapse={toggleCollapse} />
            </div>
            {/* Drag handle */}
            <div
              onMouseDown={onDragStart}
              onKeyDown={handleResizeHandleKeyDown}
              className="absolute top-3 bottom-3 right-0 w-1.5 cursor-col-resize group z-10 rounded-full hover:bg-primary/20 active:bg-primary/30 transition-colors"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("resize_sidebar")}
              aria-valuemin={SIDEBAR_MIN}
              aria-valuemax={SIDEBAR_MAX}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
            />
          </>
        )}
      </aside>

      {/* Collapsed sidebar toggle */}
      {isCollapsed && (
        <div className="hidden md:flex items-start pt-4 pl-3 flex-shrink-0">
          <button
            onClick={toggleCollapse}
            className="p-2 rounded-xl hover:bg-foreground/8 text-foreground/50 hover:text-foreground transition-colors"
            aria-label={t("expand_sidebar")}
            title={t("expand_sidebar")}
          >
            <PanelLeftOpen size={18} />
          </button>
        </div>
      )}

      {/* Right pane — chat view or empty state */}
      <main className="flex-1 overflow-hidden min-w-0 flex flex-col" id="main-content">
        <ErrorBoundary level="route">
          <Outlet />
        </ErrorBoundary>
      </main>

      <OfflineBanner />
      <InstallBanner />
      <MainWalkthrough />
    </div>
  );
}
