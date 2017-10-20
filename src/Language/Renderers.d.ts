import { Renderer } from "../Doc";
import { Maybe } from "../Data/Maybe";

export const all: Renderer[];
export function rendererForLanguage(language: string): Maybe<Renderer>;
