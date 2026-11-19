"use client";
import { createContext } from "react";

/** Pending state for SubmitButton inside an ActionForm (useFormStatus does not see onSubmit submissions). */
export const ActionPendingContext = createContext(false);
