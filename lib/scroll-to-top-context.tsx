import { createContext, useContext, useRef, useCallback } from 'react';

type Listener = () => void;

interface ScrollToTopContextType {
  subscribe: (tabName: string, listener: Listener) => () => void;
  trigger: (tabName: string) => void;
}

const ScrollToTopContext = createContext<ScrollToTopContextType>({
  subscribe: () => () => {},
  trigger: () => {},
});

export function ScrollToTopProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef<Record<string, Set<Listener>>>({});

  const subscribe = useCallback((tabName: string, listener: Listener) => {
    if (!listenersRef.current[tabName]) {
      listenersRef.current[tabName] = new Set();
    }
    listenersRef.current[tabName].add(listener);
    return () => {
      listenersRef.current[tabName]?.delete(listener);
    };
  }, []);

  const trigger = useCallback((tabName: string) => {
    listenersRef.current[tabName]?.forEach((fn) => fn());
  }, []);

  return (
    <ScrollToTopContext.Provider value={{ subscribe, trigger }}>
      {children}
    </ScrollToTopContext.Provider>
  );
}

export function useScrollToTop(tabName: string, scrollFn: () => void) {
  const { subscribe } = useContext(ScrollToTopContext);
  const scrollFnRef = useRef(scrollFn);
  scrollFnRef.current = scrollFn;

  const stableCallback = useCallback(() => {
    scrollFnRef.current();
  }, []);

  const subscribeToTab = useCallback(() => {
    return subscribe(tabName, stableCallback);
  }, [tabName, subscribe, stableCallback]);

  return subscribeToTab;
}

export function useScrollToTopTrigger() {
  const { trigger } = useContext(ScrollToTopContext);
  return trigger;
}

export { ScrollToTopContext };
