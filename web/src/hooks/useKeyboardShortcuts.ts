import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

interface KeyboardShortcutsOptions {
  onNewChat?: () => void;
  onNewFolder?: () => void;
  onOpenModelPicker?: () => void;
  onFocusSearch?: () => void;
  onDeleteChat?: () => void;
  onCloseChat?: () => void;
  onToggleSidebar?: () => void;
  onEscape?: () => void;
}

/**
 * Registers global keyboard shortcuts for the main app shell.
 * All callbacks are optional — omit any you don't need.
 *
 * Shortcuts:
 *   Cmd/Ctrl + N        → new chat
 *   Cmd/Ctrl + Shift+N  → new folder
 *   Cmd/Ctrl + K        → open model picker
 *   Cmd/Ctrl + ,        → navigate to /app/settings
 *   Cmd/Ctrl + F        → focus search
 *   Cmd/Ctrl + Delete   → delete selected chat
 *   Cmd/Ctrl + B        → toggle sidebar
 *   Cmd/Ctrl + W        → close current chat (navigate to chat list)
 *   Escape              → dismiss / cancel
 */
export function useKeyboardShortcuts({
  onNewChat,
  onNewFolder,
  onOpenModelPicker,
  onFocusSearch,
  onDeleteChat,
  onCloseChat,
  onToggleSidebar,
  onEscape,
}: KeyboardShortcutsOptions = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Don't fire shortcuts when the user is typing in an input/textarea.
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable;

      if (e.key === "Escape") {
        onEscape?.();
        return;
      }

      // Modifier-key shortcuts — skip when typing in inputs.
      if (!mod || isEditable) return;

      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          if (e.shiftKey) {
            onNewFolder?.();
          } else {
            onNewChat?.();
          }
          break;
        case "k":
        case "K":
          e.preventDefault();
          onOpenModelPicker?.();
          break;
        case ",":
          e.preventDefault();
          void navigate("/app/settings");
          break;
        case "f":
        case "F":
          e.preventDefault();
          onFocusSearch?.();
          break;
        case "b":
        case "B":
          e.preventDefault();
          onToggleSidebar?.();
          break;
        case "Delete":
        case "Backspace":
          // Only treat Backspace as Delete on Mac (where Delete key sends Backspace)
          if (e.key === "Backspace" && !e.metaKey) break;
          e.preventDefault();
          onDeleteChat?.();
          break;
        case "w":
        case "W":
          e.preventDefault();
          if (onCloseChat) {
            onCloseChat();
          } else {
            void navigate("/app/chat");
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, onNewChat, onNewFolder, onOpenModelPicker, onFocusSearch, onDeleteChat, onCloseChat, onToggleSidebar, onEscape]);
}
