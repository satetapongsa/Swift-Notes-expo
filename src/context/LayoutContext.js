import React, { createContext, useCallback, useContext, useState } from 'react';
import { useLayout } from '../lib/responsive';

const LayoutContext = createContext({ railHidden: false, toggleRail: () => {} });

// Whether the left navigation rail is collapsed (tablet and desktop only).
export const LayoutProvider = ({ children }) => {
  const [railHidden, setRailHidden] = useState(false);
  const toggleRail = useCallback(() => setRailHidden(v => !v), []);
  return (
    <LayoutContext.Provider value={{ railHidden, toggleRail }}>
      {children}
    </LayoutContext.Provider>
  );
};

export const useRail = () => useContext(LayoutContext);

// The ☰ button: collapses/expands the side rail on wide screens, opens the drawer on phones.
export function useMenuButton(openDrawer) {
  const { isWide } = useLayout();
  const { toggleRail } = useRail();
  return isWide ? toggleRail : openDrawer;
}
