const fs = require("node:fs");

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const draft06MetaSchema = require("ajv/dist/refs/json-schema-draft-06.json");

const schema = JSON.parse(fs.readFileSync("TopLevel.schema", "utf8"));
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

const ajv = new Ajv({ ownProperties: true });
ajv.addMetaSchema(draft06MetaSchema);
addFormats(ajv);
ajv.addVocabulary(["qt-uri-protocols", "qt-uri-extensions"]);
ajv.addFormat("integer", true);
ajv.addFormat("boolean", true);

if (!ajv.validate(schema, input)) {
    console.error(ajv.errorsText());
    process.exit(1);
}

console.log(JSON.stringify(input));
