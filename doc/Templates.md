# Templates

quicktype allows the processing of [Handlebars](http://handlebarsjs.com) templates based on the types specified in or inferred from the input. Templates are always processed in the context of a specific target language, which makes it possible for their output to interact with the types generated for that target language.

## Invocation

    quicktype --lang csharp --template TEMPLATE-FILE ./test/inputs/json/samples/kitchen-sink.json

## Example

```
{{#each namedTypes}}
  {{#if_eq type.kind "class"}}
    public partial class {{{assignedName}}} {
      {{#each properties}}
        [JsonProperty("{{{string_escape @key}}}")]
        public {{{csType}}} {{{assignedName}}} { get; set; }

      {{/each}}
    }
  {{/if_eq}}
  {{#if_eq type.kind "enum"}}
    public enum {{{assignedName}}} {
      {{#each cases}}{{#unless @first}}, {{/unless}}{{{assignedName}}}{{/each}}
    }
  {{/if_eq}}
  {{#if_eq type.kind "union"}}
    public partial struct {{{assignedName}}}
    {
    {{#each members}}
      public {{{nullableCSType}}} {{{assignedName}}};
    {{/each}}
    }
  {{/if_eq}}

{{/each}}

{{#each topLevels}}
  public partial class {{{assignedTopLevelName}}} {
    public static {{{csType}}} FromJson(string json) => JsonConvert.DeserializeObject<{{{csType}}}>(json, Converter.Settings);
  }
{{/each}}

{{#each namedTypes}}{{#if_eq type.kind "enum"}}
  static class {{{extensionsName}}}
  {
    public static {{{assignedName}}}? ValueForString(string str)
    {
      switch (str)
      {
        {{#each cases}}
	  case "{{{string_escape @key}}}": return {{{../assignedName}}}.{{{assignedName}}};
	{{/each}}
          default: return null;
      }
    }

    public static {{{assignedName}}} ReadJson(JsonReader reader, JsonSerializer serializer)
    {
        var str = serializer.Deserialize<string>(reader);
        var maybeValue = ValueForString(str);
        if (maybeValue.HasValue) return maybeValue.Value;
        throw new Exception("Unknown enum case " + str);
    }

    public static void WriteJson(this {{{assignedName}}} value, JsonWriter writer, JsonSerializer serializer)
    {
      switch (value)
      {
        {{#each cases}}
	  case {{{../assignedName}}}.{{{assignedName}}}: serializer.Serialize(writer, "{{{string_escape @key}}}"); break;
	{{/each}}
      }
    }
  }
{{/if_eq}}{{/each}}


public static class Serialize {
  {{#each topLevels}}
    public static string ToJson(this {{{csType}}} self) => JsonConvert.SerializeObject(self, Converter.Settings);
  {{/each}}
}

public class Converter
{
  public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
  {
      MetadataPropertyHandling = MetadataPropertyHandling.Ignore,
      DateParseHandling = DateParseHandling.None,
  };
}
```
