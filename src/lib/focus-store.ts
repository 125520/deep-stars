import { parseSession, serializeSession, type FocusSession } from "@/lib/focus";

/**
 * 专注会话的本地存储
 * ══════════════════════════════════════════════════════════════════
 *
 * 为什么不是「在 useEffect 里 setState 读 localStorage」：
 *
 * 那是最直觉的写法，但它有两个毛病 —— 一次多余的级联渲染，
 * 以及在服务端根本没有 localStorage、只能靠一个 `mounted` 标志打补丁。
 * **localStorage 恰恰就是"外部可变数据源"**，而 React 为这类数据准备的
 * 工具是 useSyncExternalStore：它自带 getServerSnapshot（SSR 直接给 null），
 * 也自带订阅语义，将来要做多标签页同步也只是多一个 storage 事件监听。
 *
 * ⚠️ getSnapshot **必须返回稳定引用**：每次返回新对象会让 React 认为
 * 数据一直在变，直接进入无限重渲染。所以这里用 cache 持有同一个对象。
 */

const STORAGE_KEY = "deep-stars:focus-session";

let cache: FocusSession | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

export function getSnapshot(): FocusSession | null {
  if (!hydrated && typeof window !== "undefined") {
    cache = parseSession(window.localStorage.getItem(STORAGE_KEY));
    hydrated = true;
  }
  return cache;
}

/** 服务端没有 localStorage，一律按"没有会话"渲染，水合后再切换 */
export function getServerSnapshot(): FocusSession | null {
  return null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFocusSession(next: FocusSession | null): void {
  cache = next;
  hydrated = true;
  if (typeof window !== "undefined") {
    if (next) window.localStorage.setItem(STORAGE_KEY, serializeSession(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  }
  for (const listener of listeners) listener();
}
