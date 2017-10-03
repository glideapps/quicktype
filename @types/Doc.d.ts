import { OptionSpecification } from "./Options";

export interface Renderer {
  displayName: string;
  names: [string];
  extension: string;
  aceMode: string;
  options: [OptionSpecification];
}
