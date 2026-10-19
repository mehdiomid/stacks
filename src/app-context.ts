import { createContext, useContext } from 'react';

export interface AppActions {
  toast: (message: string) => void;
  /** Opens Settings, optionally with a message at the top (for example, "Add your API key"). */
  openSettings: (notice?: string) => void;
}

export const AppContext = createContext<AppActions>({ toast: () => {}, openSettings: () => {} });
export const useApp = () => useContext(AppContext);
