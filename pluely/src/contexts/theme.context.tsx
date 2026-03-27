import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { STORAGE_KEYS } from "@/config/";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  transparency: number;
  onSetTransparency: (transparency: number) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  transparency: 10,
  onSetTransparency: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = STORAGE_KEYS.THEME,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [transparency, setTransparency] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.TRANSPARENCY);
    return stored ? parseInt(stored, 10) : 10;
  });

  // Stable mediaQuery ref — created once, not on every render
  const mediaQueryRef = useRef(window.matchMedia("(prefers-color-scheme: dark)"));
  const [isSystemThemeDark, setIsSystemThemeDark] = useState(mediaQueryRef.current.matches);

  // Self-echo guard: skip data-updated events for keys this window just wrote
  const recentlyWrittenKeys = useRef<Set<string>>(new Set());

  // Track system theme changes
  useEffect(() => {
    const mq = mediaQueryRef.current;
    const handler = (e: MediaQueryListEvent) => setIsSystemThemeDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // --- Tauri push-based cross-window sync ---
  useEffect(() => {
    const unlisten = listen<string>("data-updated", (event) => {
      const key = event.payload;
      if (recentlyWrittenKeys.current.has(key)) return;
      if (key === STORAGE_KEYS.TRANSPARENCY) {
        const stored = localStorage.getItem(STORAGE_KEYS.TRANSPARENCY);
        if (stored) setTransparency(parseInt(stored, 10));
      }
      if (key === storageKey) {
        const stored = localStorage.getItem(storageKey);
        if (stored) setTheme(stored as Theme);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [storageKey]);

  useEffect(() => {
    const root = window.document.documentElement;
    const mq = mediaQueryRef.current;

    const applyTheme = (currentTheme: Theme) => {
      root.classList.remove("light", "dark");

      if (currentTheme === "system") {
        const systemTheme = mq.matches ? "dark" : "light";
        root.classList.add(systemTheme);
      } else {
        root.classList.add(currentTheme);
      }
    };

    const updateTheme = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    applyTheme(theme);

    if (theme === "system") {
      mq.addEventListener("change", updateTheme);
    }

    return () => {
      if (theme === "system") {
        mq.removeEventListener("change", updateTheme);
      }
    };
  }, [theme]);

  // Apply transparency globally
  useEffect(() => {
    const root = window.document.documentElement;
    const opacity = (100 - transparency) / 100;

    root.style.setProperty("--opacity", opacity.toString());

    if (transparency > 0) {
      root.style.setProperty("--backdrop-blur", "blur(12px)");
    } else {
      root.style.setProperty("--backdrop-blur", "none");
    }
  }, [transparency]);

  const onSetTransparency = useCallback((t: number) => {
    const val = t.toString();
    localStorage.setItem(STORAGE_KEYS.TRANSPARENCY, val);
    setTransparency(t);
    recentlyWrittenKeys.current.add(STORAGE_KEYS.TRANSPARENCY);
    invoke("save_persistent_data", { key: STORAGE_KEYS.TRANSPARENCY, data: val }).catch(console.error);
    setTimeout(() => recentlyWrittenKeys.current.delete(STORAGE_KEYS.TRANSPARENCY), 500);
  }, []);

  const handleSetTheme = useCallback((newTheme: Theme) => {
    localStorage.setItem(storageKey, newTheme);
    setTheme(newTheme);
    recentlyWrittenKeys.current.add(storageKey);
    invoke("save_persistent_data", { key: storageKey, data: newTheme }).catch(console.error);
    setTimeout(() => recentlyWrittenKeys.current.delete(storageKey), 500);
  }, [storageKey]);

  const value = useMemo(() => ({
    theme,
    setTheme: handleSetTheme,
    isSystemThemeDark,
    transparency,
    onSetTransparency,
  }), [theme, handleSetTheme, isSystemThemeDark, transparency, onSetTransparency]);

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
