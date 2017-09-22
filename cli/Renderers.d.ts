interface Renderers {
  all: Renderer[];
  rendererForLanguage(language: string): Maybe<Renderer>;
}
