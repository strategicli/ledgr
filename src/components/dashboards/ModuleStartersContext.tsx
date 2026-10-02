"use client";

// Module-supplied presets, provided once by DashboardClient so a container's inner
// Add menu offers the same ones as the top-level menu without prop-drilling.
import { createContext, useContext } from "react";
import type { StarterWidget } from "@/lib/starter-widgets";

const ModuleStartersContext = createContext<StarterWidget[]>([]);

export const ModuleStartersProvider = ModuleStartersContext.Provider;
export const useModuleStarters = () => useContext(ModuleStartersContext);
