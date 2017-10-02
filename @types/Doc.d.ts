import { OptionSpecification } from "./Options";

declare namespace Doc {
  export interface Renderer {
    displayName: string;
    names: [string];
    extension: string;
    aceMode: string;
    options: [OptionSpecification];
  }
}
export = Doc;
export as namespace Doc;
