import { Config } from "./Config";
import { Either } from "./Data.Either";
import { ErrorMessage, SourceCode } from "./Core";

declare namespace Main {
  export function main(config: Config): Either<ErrorMessage, SourceCode>;

  export function mainWithOptions(options: {
    [name: string]: string;
  }): ((config: Config) => Either<ErrorMessage, SourceCode>);

  export function urlsFromJsonGrammar(
    json: object
  ): Either<string, { [key: string]: string[] }>;

  export const intSentinel: string;
}

export = Main;
export as namespace Main;
