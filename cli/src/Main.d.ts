interface Renderer {
    name: string;
    extension: string;
    aceMode: string;
}

type SourceCode = string;
type ErrorMessage = string;

interface Main {
    renderers: Renderer[];
    main(config: Config): Either<ErrorMessage, SourceCode>;
    urlsFromJsonGrammar(json: object): Either<string, { [key: string]: string[] }>;
    intSentinel: string;
}

type Json = object;
type IRTypeable = Json | string;

type TopLevelConfig = 
     | { name: string; samples: IRTypeable[]; }
     | { name: string; schema: Json; };

interface Config {
    language: string;
    topLevels: TopLevelConfig[];     
}