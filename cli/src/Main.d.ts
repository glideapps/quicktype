interface JsonArrayMap {
    [key: string]: object[];
  }

interface Renderer {
    name: string;
    extension: string;
    aceMode: string;
}

type Pipeline = ({ input: JsonArrayMap, renderer: Renderer }) => Either<string, string>;

interface Main {
    renderers: Renderer[];
    renderFromJsonArrayMap: Pipeline;
    renderFromJsonSchemaArrayMap: Pipeline;
    urlsFromJsonGrammar(json: object): Either<string, JsonArrayMap>;
}