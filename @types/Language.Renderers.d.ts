import { Renderer } from "./Doc";
import { Maybe } from "./Data.Maybe";

declare namespace Language_Renderers {
  export const all: Renderer[];
  export function rendererForLanguage(language: string): Maybe<Renderer>;
}

export = Language_Renderers;
export as namespace Language_Renderers;
